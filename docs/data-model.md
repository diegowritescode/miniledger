# Data Model

The schema is the final arbiter of correctness in MiniLedger: money invariants are enforced by
the database, not only by application code ([ADR-003](adr/003-persistence-and-orm.md)). This
document tracks the tables as they land, slice by slice.

Currently modelled: **`accounts`** (the `Account` aggregate and the `@world` system account).
The `journal_transactions`, `postings`, and materialized `account_balances` tables — together with
the deferred sum-zero constraint trigger ([ADR-005](adr/005-double-entry-model.md)) and the
`SELECT … FOR UPDATE` balance path ([ADR-006](adr/006-concurrency-safe-balances.md)) — are
intentionally deferred to a later slice and are not part of this schema yet.

## Accounts

An account has an identity, fixes exactly one currency, and carries an overdraft policy. There are
two kinds: ordinary **`user`** accounts and the privileged **`system`** account (`@world`).

### `accounts`

| Column            | Type          | Null | Default             | Notes                                                |
| ----------------- | ------------- | ---- | ------------------- | ---------------------------------------------------- |
| `id`              | `uuid`        | no   | `gen_random_uuid()` | Primary key.                                         |
| `type`            | `text`        | no   | —                   | `'user'` or `'system'` (see `accounts_type_check`).  |
| `currency`        | `text`        | no   | —                   | ISO 4217 code; an account fixes one currency.        |
| `overdraft_floor` | `bigint`      | yes  | —                   | Minor units. `NULL` = overdraft-exempt.              |
| `handle`          | `text`        | yes  | —                   | `'@world'` for the system account; `NULL` for users. |
| `created_at`      | `timestamptz` | no   | `now()`             | Creation instant.                                    |

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

## Migrations

Schema evolves through generated, reviewable SQL migrations (`drizzle-kit generate`), applied in
every environment by the lean `drizzle-orm` runtime migrator ([ADR-003](adr/003-persistence-and-orm.md)).

| Migration                   | Purpose                                                                 |
| --------------------------- | ----------------------------------------------------------------------- |
| `0000_solid_cammi`          | `app_meta` bootstrap table.                                             |
| `0001_round_dexter_bennett` | `accounts` table, the `type` check, and the partial unique index.       |
| `0002_seed_world_accounts`  | Seeds one `@world` system account per supported currency (USD/EUR/JPY). |

The `@world` seed is **idempotent** — each insert is guarded by
`WHERE NOT EXISTS (SELECT 1 FROM accounts WHERE handle = '@world' AND currency = …)` — so applying
migrations from an empty database or re-running them never produces duplicate system accounts.
