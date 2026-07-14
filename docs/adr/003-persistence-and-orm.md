# ADR-003: Persistence & ORM — PostgreSQL with Drizzle

- **Status:** Accepted (2026-07-13)
- **Date:** 2026-07-13
- Carries AccessCore [ADR-005](https://github.com/diegowritescode/accesscore/blob/main/docs/adr/005-persistence-and-orm.md);
  the same ORM choice and Unit-of-Work discipline, applied to a ledger where the database is the
  final arbiter of correctness.

## Context

Persistence in MiniLedger is not a storage detail — it is **load-bearing for correctness**. The
transactional guarantees the ledger depends on live in the database, not in application code:

- **DB-enforced invariants** — a row-level `CHECK (amount <> 0)` and a
  `CONSTRAINT TRIGGER … DEFERRABLE INITIALLY DEFERRED` asserting `SUM(amount) = 0` per
  transaction at COMMIT ([ADR-005](005-double-entry-model.md)).
- **Pessimistic locking** — `SELECT … FOR UPDATE` on `account_balances` rows, acquired in a
  total order, to make concurrent transfers safe ([ADR-006](006-concurrency-safe-balances.md)).
- **Append-only enforcement** — `REVOKE UPDATE, DELETE` on `postings` as defense in depth.

The domain layer must stay entirely free of any ORM. The chosen tool must be modern, type-safe,
and — critically — must **not fight raw SQL**, because these guarantees are expressed in SQL
(triggers, `FOR UPDATE`, grants) that an ORM abstraction would obscure.

## Decision

Use **PostgreSQL** with **Drizzle ORM** (via the `node-postgres`/`pg` driver) as the
infrastructure-layer persistence adapter, and **drizzle-kit** for generated SQL migrations.

- **Schema stays in infrastructure.** Drizzle table definitions live only in the infra layer.
  Repository **ports** are defined in the application layer and return **domain aggregates/value
  objects** (`Account`, `JournalTransaction`, `Money`); the Drizzle adapter maps **rows ↔ domain
  explicitly** with hand-written mappers per aggregate. No decorator entities, no domain leakage.
- **Migrations, two-track.** `drizzle-kit` **generates** SQL migration files at development time.
  A runtime **`migrate.ts`** applies them in every environment using the **`drizzle-orm`
  programmatic migrator** — not `drizzle-kit` at runtime. `drizzle-kit` is a dev/CLI tool; the
  container startup path depends only on the lean `drizzle-orm` migrator, so production never
  ships or invokes the generator. There is **no `synchronize`**; the schema is only ever the sum
  of applied migrations. The bespoke SQL the ledger needs (the deferred constraint trigger, the
  `REVOKE`) is authored as hand-written migration steps.
- **Unit of Work with an opaque `Tx`.** Use cases run inside
  `unitOfWork.withTransaction(tx => …)`, where `tx` is an **opaque `Tx` handle**, never Drizzle's
  transaction type. Repository ports accept an optional `Tx` on write methods; the Drizzle
  adapter binds the real executor internally. The application layer therefore never references
  Drizzle — the transfer's postings, the `account_balances` update, and any audit write commit
  **atomically** through one boundary while hexagonal purity is preserved
  ([ADR-001](001-architecture-style.md)).
- **Constraints are declarative.** Unique, FK, and `CHECK` constraints are declared and emitted
  to migrations; `bigint` money columns ([ADR-004](004-money-representation.md)) and the deferred
  sum-zero trigger ([ADR-005](005-double-entry-model.md)) are schema, not application checks.

## Fit assessment

**Verdict: fits well — Drizzle's SQL-first stance is an asset, not a tax, for a ledger.**

- ✅ Keeps the ORM in infrastructure; the explicit mapper *strengthens* the hexagonal boundary.
- ✅ SQL-first is exactly right where correctness lives in SQL — triggers, `FOR UPDATE`, `REVOKE`,
  and hand-written constraints are first-class, not fought.
- ✅ Real, reviewable SQL migrations via drizzle-kit; a lean runtime migrator via drizzle-orm.
- ✅ Native transactions cover the atomic transfer + balance update.

Friction, and how it is neutralized:

- **`bigint` marshalling** — `pg` returns `bigint` columns as strings by default; the `Money`
  mapper converts at the row↔domain boundary so the domain only ever sees a JS `bigint`
  ([ADR-004](004-money-representation.md)). Localized, tested.
- **Manual domain↔row mapping** — standardized per-aggregate mappers; boilerplate accepted as a
  clean-architecture feature, not a cost.
- **No first-party NestJS module** — a small DI module provides the `db` instance and the UoW.
- **Smaller ecosystem than Prisma/TypeORM** — production-ready; no blocker.

## Consequences

### Positive

- The correctness-critical SQL (deferred trigger, `FOR UPDATE`, `REVOKE`) is expressed directly
  and reviewed in migrations, not hidden behind an abstraction.
- Clean hexagonal boundary; the opaque-`Tx` UoW makes atomic multi-write transactions the norm.
- Type-safe queries and a real migration history for a `docker compose up` clean-clone boot.

### Negative / costs

- More hand-written mapping and an explicit UoW than a batteries-included ORM would demand.
- Some critical SQL is hand-authored in migrations (triggers/grants), so migration review is
  itself part of the correctness surface — covered by integration tests against real Postgres.

## Alternatives considered

- **Prisma** — rejected: excellent DX, but its client leaks into the architecture and gives less
  control over the exact SQL (deferred constraint triggers, `FOR UPDATE`, `REVOKE`) the ledger's
  guarantees are written in.
- **TypeORM** — rejected: decorator entities invite domain leakage into the aggregates, and its
  abstraction fights the bespoke locking/constraint SQL; maintenance momentum has slowed.
- **Raw `pg` with hand-written SQL only** — rejected: no type inference, no migration cohesion,
  and every query becomes a mapping chore; Drizzle gives the same SQL control with types and a
  migration story.
- **Kysely** — close runner-up (also SQL-first, type-safe); Drizzle chosen for tighter
  schema-plus-migration cohesion and continuity with AccessCore
  [ADR-005](https://github.com/diegowritescode/accesscore/blob/main/docs/adr/005-persistence-and-orm.md).
