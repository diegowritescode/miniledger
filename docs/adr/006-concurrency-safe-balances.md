# ADR-006: Concurrency-safe balances

- **Status:** Accepted (2026-07-13)
- **Date:** 2026-07-13
- **The core engineering decision of MiniLedger.** Sum-zero ([ADR-005](005-double-entry-model.md))
  guarantees a *transaction* balances; this ADR guarantees *balances* stay correct under
  concurrency — no lost updates, no overdraft races, no deadlocks.

## Context

Postings are append-only and are the source of truth
([ADR-005](005-double-entry-model.md)), but reading a balance by summing every posting on every
request does not scale and, worse, is **racy** under concurrent transfers. The hard requirements:

- **No lost updates** — two concurrent transfers touching the same account must both be reflected.
- **No negative-balance race** — an overdraft-guarded account must never dip below its floor even
  when two transfers each individually "fit" but together do not (a **write-skew** hazard).
- **No deadlocks** — concurrent `A→B` and `B→A` transfers must not lock each other out.
- **Continuous verifiability** — the materialized balance must be reconcilable against the
  postings at any time.

## Decision

**Append-only postings are the source of truth; a materialized `account_balances` row is updated
in the same transaction as the postings, under `SELECT … FOR UPDATE`, with the involved account
locks acquired in a total order. The overdraft guard reads the locked balance.**

Per transfer, inside one UoW transaction ([ADR-003](003-persistence-and-orm.md)):

1. **Lock in a total order.** Collect the involved account ids, **sort by account id**, and
   `SELECT … FOR UPDATE` each `account_balances` row in that order. Sorting is the deadlock
   defense: every transaction that touches accounts `A` and `B` locks `min(A,B)` first,
   regardless of transfer direction.
2. **Guard against overdraft on the locked row.** The sufficiency check reads the **just-locked**
   balance, so no concurrent writer can change it between check and update. Accounts below their
   overdraft floor are rejected; the `@world` system account is exempt
   ([ADR-005](005-double-entry-model.md)).
3. **Append postings and update balances atomically.** Insert the balanced postings and `UPDATE`
   each locked `account_balances` row by the signed delta, in the same transaction. Commit
   applies the deferred sum-zero trigger ([ADR-005](005-double-entry-model.md)); everything
   commits or rolls back together.
4. **Carry `balance_after` on each posting.** Each posting records the account balance immediately
   after it, giving a third, per-row reconciliation anchor.

### Correctness argument

- **No lost updates.** The `UPDATE` runs while the transaction holds the row's `FOR UPDATE` lock,
  so same-account writes **serialize**; the second transfer sees the first's committed delta.
- **No negative-balance race.** The sufficiency check reads the **locked** row, closing the
  write-skew window — a concurrent transfer cannot slip a competing debit in between check and
  update because it is blocked on the same lock.
- **No deadlocks.** Ordered acquisition means `A→B` and `B→A` both take `min(id)` first; there is
  no cyclic wait, so the classic transfer deadlock cannot form.
- **Reconciliation invariant.** At rest,
  `account_balances.balance == SUM(postings.amount) == last posting.balance_after` for every
  account — three independent representations that must agree, giving the `audit` module
  ([ADR-001](001-architecture-style.md)) a continuous consistency check.

### How it is proven

- **Property-based tests (fast-check)** over the pure balance-folding logic: **conservation of
  money** (global sum stays zero), **reconciliation** (materialized == summed), and **no
  overdraft** (a guarded account never crosses its floor) hold for arbitrary generated transfer
  sequences.
- **A real-Postgres concurrency integration test:** fire **K concurrent transfers via
  `Promise.all`** against the same accounts and assert the **exact** final balance with **no
  overdraft** and no lost update — exercising the actual locks, not a mock.

## Consequences

### Positive

- **O(1) balance reads** from the materialized row, with correctness guaranteed by locking rather
  than by re-summing on every request.
- **Overdraft and lost-update safety are structural** — enforced by the DB lock, not by
  application-level optimism.
- **Deadlock-free by construction** via ordered acquisition — a well-known, auditable technique.
- **Self-checking** — the triple reconciliation invariant makes drift detectable, not silent.

### Negative / costs

- **Serialized writes per account** — hot accounts (e.g. `@world`) become a contention point; row
  locking trades some parallelism for correctness. Acceptable at this scale, and measurable.
- **Two things to keep in step** — postings and the materialized balance. Mitigated by writing
  both in one transaction and by the reconciliation invariant the `audit` module verifies.
- **Locking discipline is load-bearing** — forgetting the ordered `FOR UPDATE` on a new write
  path would reintroduce the hazards; the integration test guards the primary path.

## Alternatives considered

- **Append-only + `SUM()` on read at READ COMMITTED** — rejected: the overdraft check and the
  effective write happen on an unlocked snapshot, so two transfers that each individually fit can
  both commit and overdraw the account — a textbook **write-skew** that produces a negative
  balance.
- **SERIALIZABLE (SSI) isolation everywhere** — valid and correct, but rejected as the default:
  it adds **retry-on-`40001`** (serialization-failure) machinery and its own contention that this
  scale does not need. **Documented escape hatch:** if lock contention on hot accounts ever
  dominates, moving the transfer path to SERIALIZABLE with a bounded retry loop is the sanctioned
  upgrade.
- **Postgres advisory lock per account** (`pg_advisory_xact_lock`) — rejected here: it is
  effectively `FOR UPDATE` **without a row** to hold the balance and reconcile against. AccessCore
  uses advisory locks for commit-ordered revisions
  ([ADR-005](https://github.com/diegowritescode/accesscore/blob/main/docs/adr/005-persistence-and-orm.md)) where there is no natural
  row; MiniLedger has a real `account_balances` row, so `FOR UPDATE` on that row is cleaner and
  gives the reconciliation anchor for free.
- **Optimistic concurrency (version column, compare-and-swap)** — rejected: under the expected
  contention it degrades to a retry storm on hot accounts, and it still needs the sufficiency
  check to be re-validated on retry; pessimistic row locking is simpler and predictable here.
