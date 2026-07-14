# Testing Strategy

Correctness is the product here, so the tests are structured to prove the ledger's invariants
rather than merely exercise its endpoints. Three layers do distinct jobs, and the correctness
claims of [ADR-005](adr/005-double-entry-model.md) and [ADR-006](adr/006-concurrency-safe-balances.md)
each have a test that would fail if the guarantee were lost.

## Pyramid

- **Unit + property (pure domain, no IO).** The money value objects, the `JournalTransaction`
  aggregate, the overdraft guard, and the balance fold are tested in isolation.
  **Property-based tests (fast-check)** assert the laws, not just examples:
  - money arithmetic is exact for arbitrary `bigint` amounts and never mixes currencies;
  - a `JournalTransaction` constructs **iff** its non-zero, single-currency postings sum to zero;
  - **conservation** — a balancing leg always closes a transaction and it nets to zero;
  - **no-overdraft** — a floored account never crosses its floor when only sufficient deltas apply.
- **Integration (real PostgreSQL).** The database-enforced guarantees are tested against a real
  Postgres (a service container in CI, `docker compose` locally), because they live in SQL:
  - **the deferred sum-zero trigger** — raw inserts that bypass the domain: a balanced multi-leg
    transaction commits, an unbalanced one **fails at COMMIT**, a zero-amount posting fails the CHECK;
  - **repository round-trips** through the opaque-`Tx` unit of work;
  - **concurrency ([ADR-006](adr/006-concurrency-safe-balances.md)) — the core signal:** K
    concurrent transfers via `Promise.all` against the same accounts assert **exact** final
    balances (no lost update); a concurrent overdraft race confirms a floored account is **never
    overdrawn** (no write-skew); opposing `A→B` / `B→A` directions confirm the ordered
    `SELECT … FOR UPDATE` is **deadlock-free**. The materialized balance reconciles with
    `SUM(postings)`.
- **E2E (HTTP).** The account and transfer flows end to end: open accounts, deposit from `@world`,
  transfer, and the RFC 7807 rejections (insufficient funds → 422, unknown account → 404).

## Tools

Jest + ts-jest (unit/integration/e2e projects), Supertest for HTTP, **fast-check** for
property-based tests, and a real Postgres for the integration/e2e suites.

## Coverage

A single **merged** coverage gate (nyc) spans the unit, integration, and e2e suites, with
thresholds of **90% lines / 90% statements / 85% functions / 75% branches**; CI fails below them.
Declarative Drizzle table schemas and migrations are excluded — they are verified by the
integration tests against real Postgres, not by unit coverage.

## What is intentionally not tested

- **The `REVOKE UPDATE, DELETE` on `postings`** is not asserted by a test, because the app connects
  as the table owner (which bypasses the grant); the append-only guarantee is enforced structurally
  (no mutation code paths) and the least-privilege runtime role is a documented deployment step.
- **Drizzle/pg library internals** — assumed correct; the mappers and SQL are what get tested.
