# ADR-001: Architecture style — Hexagonal modular monolith with DDD

- **Status:** Accepted (2026-07-13)
- **Date:** 2026-07-13
- Carries AccessCore [ADR-001](https://github.com/diegowritescode/accesscore/blob/main/docs/adr/001-architecture-style.md);
  this ADR records the MiniLedger-specific boundary decisions on top of that pattern.

## Context

MiniLedger is a double-entry financial ledger: the primitive is a balanced journal transaction
whose postings must sum to zero, and account balances must never drift or race. Correctness is
not a feature here, it is the product — money may never be created, destroyed, or lost to a
concurrent write. The domain is genuinely non-trivial (double-entry invariants, overdraft
floors, concurrency-safe balances), yet the system must be shippable and operable by a single
developer and must read as senior engineering, not a framework tutorial.

The same two failure modes AccessCore rejected apply verbatim:

1. **Premature microservices** — network hops, deploy topology, and distributed debugging whose
   operational cost buys nothing at this scale, and which would actively harm a domain whose
   core operation is a single atomic transaction.
2. **Anemic layered CRUD** — the sum-zero rule, the currency check, and the overdraft guard
   leaking into controllers and the ORM, where they are untestable and quietly bypassable.

## Decision

Build a **modular monolith** using **Hexagonal (Ports & Adapters)** and **DDD tactical
patterns** — one deployable process, four layers per module.

- **Layers:** `domain` (pure, no NestJS/ORM), `application` (use cases + ports),
  `infrastructure` (Drizzle/Postgres adapters — see [ADR-003](003-persistence-and-orm.md)),
  `interface` (NestJS controllers, guards, DTOs).
- **One `ledger` bounded context with exactly two aggregates:**
  - **`Account`** — identity, currency, overdraft policy; the balance is materialized, not a
    field the domain freely mutates (see [ADR-006](006-concurrency-safe-balances.md)).
  - **`JournalTransaction`** — the transaction root plus its child **`Posting`** entities. A
    posting has no life outside its transaction; the transaction is the invariant boundary that
    guarantees `SUM(postings) = 0` in a single currency (see [ADR-005](005-double-entry-model.md)).
- **Errors** are modeled as a `Result`/domain-error type in domain and application; exceptions
  are reserved for genuine infrastructure failure. HTTP status mapping happens only at the
  interface layer.

### Why postings live inside the transaction aggregate

The tempting split — an `accounts` context owning balances and a separate `postings`/`entries`
context — is rejected. A transfer is **one atomic consistency boundary that spans both an
account's balance and the postings that move it**: the sum-zero check, the currency match, and
the overdraft guard are only meaningful when all legs and the affected balances commit or roll
back together. Splitting them would manufacture a **distributed-transaction smell inside a single
process** (two aggregates, two transactional roots, an eventual-consistency gap where money can
momentarily appear unbalanced) with zero scaling payoff. Keeping `JournalTransaction + Posting`
as one aggregate, and treating `Account.balance` as a materialized projection updated in the
same DB transaction, makes atomicity the default rather than something to reconstruct.

### Modules

| Module    | Responsibility                                                                                     |
| --------- | -------------------------------------------------------------------------------------------------- |
| `ledger`  | The core domain and use cases: open account, post a balanced transaction/transfer, reverse.        |
| `audit`   | Read-side verifier: recomputes `SUM(postings)` per account and reconciles it against the materialized `account_balances`; asserts conservation of money globally. No writes. |
| `access`  | Thin adapter integrating AccessCore: an **authN guard** verifying tokens and a **PEP** calling the AccessCore SDK's `check()` before privileged ledger operations. |
| `health`  | Liveness/readiness probes (DB reachability, migration state).                                      |
| `shared`  | Cross-cutting infrastructure: the `db` module and Drizzle client, config, the opaque-`Tx` `UnitOfWork` ([ADR-003](003-persistence-and-orm.md)), and the `Money`/`Currency` value objects ([ADR-004](004-money-representation.md)). |

`audit` and `access` read from or wrap `ledger` through explicit ports; no module reaches into
another's internals.

## Consequences

### Positive

- The double-entry invariants and the overdraft guard are **unit- and property-testable in pure
  isolation** (no DB, no HTTP), which is what makes the correctness claims in
  [ADR-005](005-double-entry-model.md)/[ADR-006](006-concurrency-safe-balances.md) provable.
- One transaction, one aggregate, one DB transaction → atomicity is structural, not bolted on.
- Clear seams: the `access` module is the integration point to AccessCore; a future outbox would
  be the seam to EventBridge (spine project #3) without reshaping the domain.
- Reuses a proven, documented pattern from AccessCore → consistency across the portfolio spine.

### Negative / costs

- More upfront structure and mapping boilerplate than a controller-service-repository CRUD app.
- Requires discipline to keep `audit`/`access` from reaching into `ledger` internals.
- A single bounded context can feel heavy for a small surface; justified by the correctness bar.

## Alternatives considered

- **Microservices (accounts service + postings service)** — rejected: premature distribution
  that would turn the core atomic transfer into a distributed transaction, adding sagas/2PC and
  a consistency gap to solve a problem the scale does not have.
- **Anemic layered CRUD (transaction script)** — rejected: the sum-zero, currency, and overdraft
  rules would erode into controllers and the ORM, becoming untestable and bypassable — the exact
  low-signal outcome the portfolio exists to transcend.
- **Split `Account` and `Posting` into separate bounded contexts within the monolith** —
  rejected: they share one atomic consistency boundary (a transfer), so separation buys nothing
  and reintroduces cross-aggregate coordination inside a single process.
- **Full Clean Architecture with global CQRS** — deferred: read/write separation is applied only
  where it earns its keep (the `audit` verifier reads the same tables); a separate read model is
  a later ring if reporting demands it, not a day-one cost.
