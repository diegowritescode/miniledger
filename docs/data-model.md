# Data Model

The schema is the final arbiter of correctness in MiniLedger: money invariants are enforced by
the database, not only by application code ([ADR-003](adr/003-persistence-and-orm.md)). This
document tracks the tables as they land, slice by slice.

Currently modelled: **`accounts`** (the `Account` aggregate and the `@world` system account), the
**`journal_transactions`** and append-only **`postings`** tables that record double-entry history,
and the materialized **`account_balances`** table. The correctness-critical SQL of the double-entry
model is in place: the row-level `CHECK (amount <> 0)` and the **deferred sum-zero constraint
trigger** ([ADR-005](adr/005-double-entry-model.md)), plus append-only enforcement via `REVOKE`.
The concurrency-safe write path — the ordered `SELECT … FOR UPDATE` on `account_balances`, the
overdraft guard, and the balance `UPDATE` that keeps the materialized row in step with the postings
([ADR-006](adr/006-concurrency-safe-balances.md)) — is exercised by the transfer use case in a
later slice; this slice provides the schema, the invariants, and the repositories that path builds on.

## Accounts

An account has an identity, fixes exactly one currency, and carries an overdraft policy. There are
two kinds: ordinary **`user`** accounts and the privileged **`system`** account (`@world`).

### `accounts`

| Column            | Type          | Null | Default             | Notes                                                                                                                                        |
| ----------------- | ------------- | ---- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`              | `uuid`        | no   | `gen_random_uuid()` | Primary key.                                                                                                                                 |
| `type`            | `text`        | no   | —                   | `'user'` or `'system'` (see `accounts_type_check`).                                                                                          |
| `currency`        | `text`        | no   | —                   | ISO 4217 code; an account fixes one currency.                                                                                                |
| `overdraft_floor` | `bigint`      | yes  | —                   | Minor units. `NULL` = overdraft-exempt.                                                                                                      |
| `handle`          | `text`        | yes  | —                   | `'@world'` for the system account; `NULL` for users.                                                                                         |
| `owner_id`        | `text`        | yes  | —                   | Opaque AccessCore subject that owns the account (no FK; `NULL` for system accounts). Indexed ([ADR-009](adr/009-accesscore-integration.md)). |
| `created_at`      | `timestamptz` | no   | `now()`             | Creation instant.                                                                                                                            |

`overdraft_floor` is stored as `bigint` in minor units, consistent with the money representation in
[ADR-004](adr/004-money-representation.md); values are marshalled as JS `bigint` at the row↔domain
boundary so the domain never sees a raw string.

### Invariants

- **Account type is constrained.** `CONSTRAINT accounts_type_check CHECK (type IN ('user','system'))`
  makes any other type value impossible, even for a direct SQL write.
- **One `@world` per currency.** A partial unique index,
  `CREATE UNIQUE INDEX accounts_handle_currency_key ON accounts (handle, currency) WHERE handle IS NOT NULL`,
  guarantees at most one account per `(handle, currency)` pair. Because it is partial (only rows
  with a non-null `handle`), it constrains the named system accounts without forcing uniqueness on
  the many user accounts, whose `handle` is `NULL`.
- **Overdraft floor semantics.** `overdraft_floor` is the lowest balance an account may reach, in
  minor units. A **`NULL` floor means overdraft-exempt** — the account may go arbitrarily negative.
  User accounts open with a floor of `0` (they may not go negative); the `@world` system account has
  a `NULL` floor. Modelling exemption as `NULL` (rather than a sentinel like a very negative number)
  keeps the "no floor at all" case explicit and unambiguous. The floor is defined here; it is
  _enforced_ on the balance path in a later slice ([ADR-006](adr/006-concurrency-safe-balances.md)).

### The `@world` system account, per currency

MiniLedger anchors the ledger with a single **`@world`** equity/system account so that money
entering or leaving the system is still modelled as a **balanced** transfer to or from `@world`,
keeping every transaction sum-zero ([ADR-005](adr/005-double-entry-model.md) §3). Two decisions make
`@world` **per currency** rather than a single global row:

- **An account fixes exactly one currency** ([ADR-004](adr/004-money-representation.md)): `Money`
  arithmetic and the sum-zero rule are only defined within a single currency, so a cross-currency
  account would be meaningless.
- **Conservation of money is a per-currency invariant** ([ADR-005](adr/005-double-entry-model.md)):
  `SUM(amount)` over all postings must be identically zero _within each currency_. A dedicated
  `@world` account per supported currency (USD, EUR, JPY — `Currency.codes()`) is what makes that
  a checkable global property.

The system account is **exempt from the overdraft floor** (`overdraft_floor IS NULL`) precisely
because it represents the outside world and is expected to go arbitrarily negative as value enters
the system.

## Journal transactions & postings

A **`JournalTransaction`** is the ledger primitive: an N-posting entry whose signed amounts sum to
zero ([ADR-005](adr/005-double-entry-model.md)). A transfer is the two-leg case; deposits,
withdrawals, refunds, and reversals are the same primitive with different legs. History is
**append-only and immutable** — corrections are new compensating entries, never edits.

### `journal_transactions`

| Column       | Type          | Null | Default             | Notes                                       |
| ------------ | ------------- | ---- | ------------------- | ------------------------------------------- |
| `id`         | `uuid`        | no   | `gen_random_uuid()` | Primary key.                                |
| `currency`   | `text`        | no   | —                   | The single currency shared by all its legs. |
| `created_at` | `timestamptz` | no   | `now()`             | Creation instant.                           |

### `postings`

| Column           | Type          | Null | Default             | Notes                                                                                              |
| ---------------- | ------------- | ---- | ------------------- | -------------------------------------------------------------------------------------------------- |
| `id`             | `uuid`        | no   | `gen_random_uuid()` | Primary key.                                                                                       |
| `transaction_id` | `uuid`        | no   | —                   | FK → `journal_transactions(id)`. Indexed.                                                          |
| `account_id`     | `uuid`        | no   | —                   | FK → `accounts(id)`. Indexed.                                                                      |
| `amount`         | `bigint`      | no   | —                   | Signed minor units ([ADR-004](adr/004-money-representation.md)); `> 0` debit, `< 0` credit.        |
| `balance_after`  | `bigint`      | no   | —                   | The account's balance immediately after this posting.                                              |
| `seq`            | `bigint`      | no   | identity            | Monotonic insertion order (the per-account chain order).                                           |
| `prev_hash`      | `text`        | yes  | —                   | Previous chain head for this account (`NULL` at genesis) ([ADR-008](adr/008-audit-hash-chain.md)). |
| `hash`           | `text`        | no   | —                   | `sha256(prev ‖ txId ‖ accountId ‖ amount ‖ balanceAfter)` — the account's chain link.              |
| `created_at`     | `timestamptz` | no   | `now()`             | Creation instant.                                                                                  |

Indexes on `transaction_id` and `account_id` support fetching a transaction's legs and an account's
history. `amount` and `balance_after` are `bigint` in minor units, marshalled as JS `bigint` at the
row↔domain boundary.

### Invariants

- **No no-op postings.** `CONSTRAINT postings_amount_nonzero CHECK (amount <> 0)` rejects a
  zero-amount leg **immediately** (it is a single-row check, not deferred).
- **Every transaction balances (deferred sum-zero trigger).** A single-row `CHECK` cannot span
  rows, so the per-transaction invariant is a **constraint trigger**:

  ```sql
  CREATE CONSTRAINT TRIGGER postings_balanced
    AFTER INSERT ON postings
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW
    EXECUTE FUNCTION assert_transaction_balanced();
  ```

  The `assert_transaction_balanced()` function raises unless
  `SELECT COALESCE(SUM(amount), 0) FROM postings WHERE transaction_id = NEW.transaction_id` is `0`.
  Because the trigger is **`DEFERRABLE INITIALLY DEFERRED`**, it evaluates **at COMMIT**, not per
  row — so a multi-leg transaction can insert its legs one at a time (temporarily unbalanced
  mid-transaction) and be validated only as a complete set at commit. This is the database's
  independent guarantee of sum-zero, holding even against writes that never pass through the pure
  `JournalTransaction` aggregate ([ADR-005](adr/005-double-entry-model.md)).

- **Append-only, enforced structurally and by privilege.** There are no `UPDATE`/`DELETE` code
  paths for postings. As defense in depth the migration issues
  **`REVOKE UPDATE, DELETE ON postings FROM PUBLIC`**, so even a direct SQL statement cannot mutate
  recorded history. A recorded fact stays recorded; correction is a new entry.
  - **Least-privilege runtime role (deployment hardening).** A table's **owner bypasses** grants,
    so `REVOKE … FROM PUBLIC` only bites for non-owner roles. The intended hardening is to run the
    application as a **dedicated least-privilege role that is not the table owner**, holding only
    `INSERT`/`SELECT` on `postings`. That role provisioning is a deployment concern and is
    documented here rather than built in this slice; the structural `REVOKE` is shipped now.
- **`balance_after` is a reconciliation anchor.** Each posting records the account balance
  immediately after it. At rest, for every account,
  `account_balances.balance == SUM(postings.amount) == last posting.balance_after` — three
  independent representations that must agree ([ADR-006](adr/006-concurrency-safe-balances.md)),
  giving the audit path a continuous consistency check. The write path that maintains this equality
  under concurrency (ordered `FOR UPDATE`) lands with the transfer use case.

## Account balances

The materialized **`account_balances`** table holds each account's current balance as a single row,
so a balance read is `O(1)` rather than a `SUM()` over all postings
([ADR-006](adr/006-concurrency-safe-balances.md)). Append-only postings remain the source of truth;
this row is a maintained projection of them.

### `account_balances`

| Column       | Type          | Null | Default | Notes                                                                                                               |
| ------------ | ------------- | ---- | ------- | ------------------------------------------------------------------------------------------------------------------- |
| `account_id` | `uuid`        | no   | —       | Primary key; FK → `accounts(id)`. One row per account.                                                              |
| `balance`    | `bigint`      | no   | `0`     | Current balance in minor units.                                                                                     |
| `chain_hash` | `text`        | yes  | —       | Head of the account's posting hash chain ([ADR-008](adr/008-audit-hash-chain.md)); `NULL` before its first posting. |
| `updated_at` | `timestamptz` | no   | `now()` | Last time the balance changed.                                                                                      |

### Balance-row lifecycle

- **Initialized on open.** Opening a user account initializes its `account_balances` row at `0` **in
  the same unit-of-work transaction** as the account insert (`AccountsService.open`), so an account
  never exists without its balance row.
- **Backfilled at migration.** The migration seeds a balance row for every account that already
  exists (the per-currency `@world` accounts) with an **idempotent**
  `INSERT … SELECT … ON CONFLICT (account_id) DO NOTHING`, safe to apply from an empty database or
  to re-run.
- **Updated on the transfer path.** The balance is moved under an ordered `SELECT … FOR UPDATE`
  lock in the same transaction as the postings; that write path is part of the transfer slice
  ([ADR-006](adr/006-concurrency-safe-balances.md)).

## Idempotency keys

The **`idempotency_keys`** table makes a transfer exactly-once under retries and concurrent
duplicates ([ADR-007](adr/007-idempotency.md)). The key is claimed **inside the transfer's
transaction**, so the record and the postings/balances commit or roll back together.

### `idempotency_keys`

| Column           | Type          | Null | Default | Notes                                                            |
| ---------------- | ------------- | ---- | ------- | ---------------------------------------------------------------- |
| `key`            | `text`        | no   | —       | Primary key; the client-supplied `Idempotency-Key`.              |
| `fingerprint`    | `text`        | no   | —       | Hash of the request; a reuse with a different one is a `409`.    |
| `transaction_id` | `uuid`        | yes  | —       | FK → `journal_transactions(id)`; the transfer this key produced. |
| `response`       | `jsonb`       | yes  | —       | The stored receipt, replayed verbatim on a duplicate.            |
| `created_at`     | `timestamptz` | no   | `now()` | When the key was claimed.                                        |

The unique `key` is the serialization point: a concurrent duplicate's `INSERT … ON CONFLICT DO
NOTHING` **blocks** on the owner's uncommitted row, then replays (owner committed) or takes over
(owner rolled back). See [ADR-007](adr/007-idempotency.md).

## Migrations

Schema evolves through generated, reviewable SQL migrations (`drizzle-kit generate`), applied in
every environment by the lean `drizzle-orm` runtime migrator ([ADR-003](adr/003-persistence-and-orm.md)).

| Migration                   | Purpose                                                                                                                               |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `0000_solid_cammi`          | `app_meta` bootstrap table.                                                                                                           |
| `0001_round_dexter_bennett` | `accounts` table, the `type` check, and the partial unique index.                                                                     |
| `0002_seed_world_accounts`  | Seeds one `@world` system account per supported currency (USD/EUR/JPY).                                                               |
| `0003_broad_rocket_raccoon` | `journal_transactions`, `postings` (FKs, indexes, `amount <> 0` check), and `account_balances` tables.                                |
| `0004_ledger_invariants`    | Custom SQL: the deferred sum-zero constraint trigger, `REVOKE UPDATE, DELETE ON postings`, and the idempotent balance backfill.       |
| `0005_colossal_whizzer`     | `idempotency_keys` table (FK → `journal_transactions`).                                                                               |
| `0006_sour_zaran`           | Per-account hash chain: `postings.seq`/`prev_hash`/`hash` and `account_balances.chain_hash` ([ADR-008](adr/008-audit-hash-chain.md)). |
| `0007_late_susan_delgado`   | `accounts.owner_id` + its index for local ownership ([ADR-009](adr/009-accesscore-integration.md)).                                   |

The `@world` seed is **idempotent** — each insert is guarded by
`WHERE NOT EXISTS (SELECT 1 FROM accounts WHERE handle = '@world' AND currency = …)` — so applying
migrations from an empty database or re-running them never produces duplicate system accounts.
