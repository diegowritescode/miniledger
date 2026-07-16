# ADR-011: Least-privilege runtime database role

- **Status:** Accepted (2026-07-16)
- **Date:** 2026-07-16
- How MiniLedger makes its append-only history hold **at runtime**, not just on paper.

## Context

History is protected in three layers ([ADR-005](005-double-entry-model.md),
[ADR-008](008-audit-hash-chain.md)): append-only by design (no `UPDATE`/`DELETE` code paths),
append-only by privilege (`REVOKE UPDATE, DELETE ON postings FROM PUBLIC`, migration 0004), and
tamper-evident by hash chain.

The middle layer had a gap. `REVOKE … FROM PUBLIC` removes the privilege from everyone who holds it
only through `PUBLIC` — but **a table's owner bypasses it entirely**. MiniLedger connected to Postgres
as that owner (the single role a managed database hands you), so at runtime the application _could_
have issued `UPDATE postings` / `DELETE FROM postings`. The append-only guarantee was real by design
and by hash chain, but only aspirational by privilege.

## Decision

Split the database identity in two:

- **Migrator** — the owning/admin role. Runs DDL migrations only, via a dedicated
  `MIGRATION_DATABASE_URL`. Never serves requests.
- **`miniledger_app`** — the runtime role the application connects as (`DATABASE_URL`). It is **not**
  the table owner, so `REVOKE` binds it. Migration 0010 grants it the minimum:
  - `SELECT, INSERT` on `postings` and `journal_transactions` — append-only, **no `UPDATE`/`DELETE`**;
  - `SELECT, INSERT` on `accounts` — written once on open, never mutated;
  - `SELECT, INSERT, UPDATE` on `account_balances`, `idempotency_keys`, `outbox` — the mutable state
    (`account_balances` is also locked `FOR UPDATE`, which requires `UPDATE`);
  - `USAGE` on the schema and its sequences.

The grant migration is **idempotent and environment-uniform**: it provisions the role `NOLOGIN` if it
is absent (local/CI keep using the single owner role, so `miniledger_app` exists but is unused) and
otherwise only re-applies the grants. **No password ever lives in a migration** — in production the
deployer creates the role `WITH LOGIN PASSWORD` out-of-band and wires the two connection strings.
`migrate.ts` uses `MIGRATION_DATABASE_URL ?? DATABASE_URL`, so a single-role setup still works with no
extra configuration.

## Consequences

- The append-only invariant now binds the running application, not only `PUBLIC`. A compromised app
  connection cannot rewrite or delete recorded postings — it would be denied (`42501`), on top of the
  hash chain that would detect any owner-level tampering after the fact.
- An integration test proves the property directly: connecting as `miniledger_app`, `UPDATE`/`DELETE`
  on `postings` is refused while `SELECT`/`INSERT` succeed.
- Production requires a one-time setup (create the role, set both connection strings) — documented in
  [deployment.md](../deployment.md). This is deliberate: least privilege is worth a one-time step.
- New tables added by future migrations must grant the appropriate privileges to `miniledger_app`;
  this is now part of writing a migration.
- Not addressed here: the migrator role itself is still powerful. That is inherent to running
  migrations; it is mitigated by the migrator never serving traffic.
