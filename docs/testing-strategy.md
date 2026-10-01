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
- **Browser (Playwright, `web/e2e`).** The dashboard as a visitor uses it, through the real
  backend-for-frontend, the real API and a **real AccessCore**:
  - signing in through AccessCore, the anonymous redirect, unknown credentials, sign-out;
  - the accounts list, a statement whose running balance ends at the account's balance, and the
    integrity page (money conserved, every hash chain intact);
  - a transfer between two of the owner's accounts that moves both balances, a retried transfer
    that reuses its idempotency key and posts once, opening an account;
  - the EN/ES toggle.

## Browser journeys against the released AccessCore

The `e2e` CI job does not stub the identity provider. It starts **AccessCore's published image**
(`ghcr.io/diegowritescode/accesscore-api:latest`) beside its own Postgres and Redis, seeds it,
signs in to learn the demo account's subject, and seeds MiniLedger for that owner. The suite is
therefore a consumer-side contract test: if a new AccessCore release changes the login response,
the JWKS, or the `check` contract the SDK relies on, MiniLedger's CI turns red on its next run. The
suite signs in once (a Playwright setup project) and reuses the session.

Journeys tagged `@smoke` are **read-only**, so they also run **hourly against the live dashboard**
(`Production smoke` workflow), after probing the API's `/health`, `/ready` and `/docs` and checking
that `/metrics` is not exposed.

## Tools

Jest + ts-jest (unit/integration/e2e projects), Supertest for HTTP, **fast-check** for
property-based tests, a real Postgres for the integration/e2e suites, and **Playwright** (Chromium)
for the dashboard.

## Coverage

A single **merged** coverage gate (nyc) spans the unit, integration, and e2e suites, with
thresholds of **90% lines / 90% statements / 85% functions / 75% branches**; CI fails below them.
Declarative Drizzle table schemas and migrations are excluded — they are verified by the
integration tests against real Postgres, not by unit coverage.

## Mutation testing (do the tests actually catch bugs?)

Coverage says a line _ran_; it does not say a test would _fail_ if that line were wrong.
[Stryker](https://stryker-mutator.io) injects faults into the **ledger domain** — the double-entry
invariants, overdraft rule, and per-account hash chain — and measures how many the suite kills.

Run it with `npm run mutation` (scoped to `src/ledger/domain/**`). Current score: **100% (88
mutants killed, 0 survived)**. The `account`, `journal-transaction`, `overdraft`, and `posting`
aggregates are at 100%; the property-based suites (`fast-check`) are what make that hold over
arbitrary inputs rather than a handful of examples. The exercise surfaced two real gaps and turned
them into tests: `totalAmount` was only ever asserted on balanced (sum-zero) postings — where
`sum + x` and `sum - x` are indistinguishable — and the hash chain's `'|'` field separator (which
makes the pre-image **injective**, so `('t','12')` cannot collide with `('t1','2')`) had no test
pinning it.

CI runs Stryker in a dedicated [`Mutation`](../.github/workflows/mutation.yml) workflow (on domain
changes, weekly, and on demand) with a **`break` threshold that fails the build if the score
regresses**. It is kept off the critical `verify` path deliberately — mutation score is a trend to
defend, not a per-commit blocker.

## What is intentionally not tested

- **The `REVOKE UPDATE, DELETE` on `postings`** is not asserted by a test, because the app connects
  as the table owner (which bypasses the grant); the append-only guarantee is enforced structurally
  (no mutation code paths) and the least-privilege runtime role is a documented deployment step.
- **Drizzle/pg library internals** — assumed correct; the mappers and SQL are what get tested.
