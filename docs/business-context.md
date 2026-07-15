# Business Context

## Problem

A ledger is the system of record for money. Its correctness is not a feature — it **is** the
product. Three properties must hold, always, or the ledger is worthless:

- **Exactly-once.** A client that times out on a transfer does not know whether it committed, so it
  retries. The money must move **once**, never twice.
- **Never lost, never invented.** Every transaction must net to zero (double-entry): value only ever
  **moves** between accounts, it is never created or destroyed. Summed over all accounts, the ledger
  must reconcile to zero in every currency.
- **Correct under concurrency.** Two transfers touching the same account at the same instant must
  both be reflected, must not overdraw a floored account, and must not deadlock.

Getting these wrong is the canonical way ledgers develop phantom money — a rounding drift, a
double-spend on retry, a lost update under load, an unbalanced "transfer" that wrote two rows and
hoped. MiniLedger's design makes each failure mode **structurally impossible** rather than merely
unlikely: money is exact-integer minor units ([ADR-004](adr/004-money-representation.md)); sum-zero
is enforced in the pure domain **and** by a deferred Postgres trigger
([ADR-005](adr/005-double-entry-model.md)); balances are locked in a total order so there is no lost
update, no overdraft race, no deadlock ([ADR-006](adr/006-concurrency-safe-balances.md)); retries are
idempotent via a key claimed in the same transaction ([ADR-007](adr/007-idempotency.md)); and history
is append-only and tamper-evident via a per-account hash chain
([ADR-008](adr/008-audit-hash-chain.md)).

## Why it matters

The ledger is the highest-stakes, least-forgiving service in most backends, and it exercises the two
skills that separate a senior backend engineer from a competent one: **correctness** (exact money,
provable invariants) and **concurrency** (safe under contention). Building one that is provably
correct — with property-based tests of the invariants and a real-Postgres concurrency test of the
locks — is a direct, credible demonstration of "can be trusted with the critical path." That is the
portfolio's thesis: not another CRUD app, but the part of a system that must never be wrong.

## Users / Actors

MiniLedger has no UI of its own; its callers are **operators and services** that already hold an
AccessCore identity:

- **Ledger operators / integrating services** — authenticated with an AccessCore bearer token and
  granted the `operator` relation on the `ledger` resource. They open accounts, move money, and read
  the accounts and balances they own ([security.md](security.md)).
- **Auditors** — operators with the `ledger.audit` capability, who verify an account's hash chain
  and the global conservation of money via the read-only audit endpoints.
- **The `@world` system account** — the modeling actor that anchors conservation: deposits and
  withdrawals are balanced transfers to/from `@world`, so _every_ transaction sums to zero.

## Spine narrative — the SDK's first real consumer

MiniLedger is project #2 in the portfolio spine, built directly on **AccessCore** (project #1, the
IAM flagship). Its role in the spine is deliberate: MiniLedger is the **first real consumer of the
AccessCore SDK** (`@diegowritescode/accesscore-sdk`), so the integration is a genuine end-to-end
proof rather than a demo. Consuming it surfaced **three concrete SDK gaps**, each now documented as
an upstream candidate ([ADR-009](adr/009-accesscore-integration.md)):

1. **No authN guard.** The SDK ships a PEP (permit/deny) but no way to authenticate the caller or
   expose _who_ they are. MiniLedger's local `AccessTokenGuard` (offline EdDSA/JWKS verify, attaching
   the principal) is the reference implementation for a future SDK guard.
2. **No `forRootAsync`.** The SDK's `AccessCoreModule.forRoot(config)` takes static config only, so
   MiniLedger wires the client manually via a `useFactory` that injects the validated environment —
   the pattern a `forRootAsync` should provide.
3. **An unpublishable `workspace:*` dependency.** The SDK could not be installed by an external repo
   until it was published to public npmjs with real version ranges; this consumer forced that
   packaging fix (AccessCore
   [ADR-017](https://github.com/diegowritescode/accesscore/blob/main/docs/adr/017-sdk-packaging-and-publishing.md)),
   which is what makes MiniLedger clone-and-run with no token.

Reuse across the spine is shown by **carrying patterns forward, documented** — the hexagonal layout,
the opaque-`Tx` unit of work, and ADR discipline come from AccessCore by convention, not by importing
a shared internal package.

## Scope

**In scope**

- Double-entry accounts, balanced journal transactions, and immediate transfers (deposits/withdrawals
  as transfers to/from `@world`).
- Concurrency-safe materialized balances with an overdraft floor.
- Idempotent transfers via `Idempotency-Key`.
- A read-only audit surface: per-account hash-chain verification, reconciliation, and conservation.
- AccessCore-delegated authentication and coarse authorization, plus local account ownership.
- Multi-currency accounts (USD/EUR/JPY) — one currency per account and per transaction.

**Out of scope (deliberately — see [trade-offs.md](trade-offs.md))**

- Holds / two-phase (authorize-then-capture) transfers.
- Cross-currency FX and fractional minor units.
- Cryptographic signing / non-repudiation (the chain is tamper-evident, not signed).
- Domain-event emission to EventBridge (spine project #3).
- Interest, fees schedules, statements, and any end-user UI.
