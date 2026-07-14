# ADR-005: Double-entry model & sum-zero enforcement

- **Status:** Accepted (2026-07-13)
- **Date:** 2026-07-13
- The domain heart of MiniLedger: what a transaction *is*, and why it can never be unbalanced.

## Context

Double-entry accounting's defining rule is that every transaction moves value between accounts
such that **nothing is created or destroyed** — the postings net to zero. Encoding that rule
loosely (e.g. a "transfer" endpoint that writes two rows and hopes) is how ledgers develop
phantom money. The invariant must be **impossible to violate**, not merely checked in a happy
path, and it must survive both a buggy code path and a direct SQL write.

Two design forces: the invariant must be **provable in the pure domain** (unit- and
property-testable with no database), and it must be **guaranteed by the database** as the final
authority, because [ADR-003](003-persistence-and-orm.md) makes Postgres the arbiter of
correctness. A single-currency constraint ([ADR-004](004-money-representation.md)) makes the sum
well-defined.

## Decision

The ledger primitive is a balanced **`JournalTransaction`**: an N-posting entry whose signed
amounts sum to zero. A **transfer is simply the two-leg case** (one debit, one credit); refunds,
splits, and fees are the same primitive with more legs. Postings are **append-only and
immutable**.

### 1. Append-only postings

There are **no UPDATE or DELETE code paths** for postings — the domain exposes only creation.
As defense in depth, the migration issues **`REVOKE UPDATE, DELETE ON postings`** so even a
direct SQL statement or a future careless query cannot mutate history. A recorded fact stays
recorded; correction is expressed as a new entry, never an edit.

### 2. Sum-zero enforced twice — domain and database

The invariant is asserted at two independent layers, by design:

1. **In the `JournalTransaction` aggregate (pure).** The aggregate **cannot be constructed**
   unless its postings net to zero **and** share one currency. The check is pure — no IO — so it
   is covered by unit tests and **property-based tests** (fast-check): for any generated set of
   postings, construction succeeds iff the signed sum is zero and currencies match.
2. **In the database at COMMIT.** A **`CONSTRAINT TRIGGER … DEFERRABLE INITIALLY DEFERRED`**
   asserts `SUM(amount) = 0` grouped by transaction, evaluated **at commit time**. A single-row
   `CHECK` constraint **cannot span rows**, so it structurally cannot express a per-transaction
   sum — the deferred constraint trigger is the correct multi-row-invariant mechanism, and
   deferring to COMMIT is what lets all legs be inserted first and validated as a set. A
   row-level **`CHECK (amount <> 0)`** additionally forbids no-op postings.

The two layers are not redundant belt-and-braces theater: the domain check gives fast, testable,
explainable rejection with a `Result` error; the DB trigger guarantees the invariant holds even
against writes that never pass through the domain (migrations, admin SQL, bugs, future modules).

### 3. Conservation of money as a true global invariant

A single **`@world` / equity system account** anchors the system. External deposits and
withdrawals are modeled as **balanced transfers to/from `@world`**, so *every* transaction —
including "money entering the system" — has postings summing to zero. The system account is
**exempt from the overdraft floor** ([ADR-006](006-concurrency-safe-balances.md)) precisely
because it represents the outside world and is expected to go arbitrarily negative. The payoff:
`SUM(amount)` over **all** postings in a currency is identically zero, so **conservation of
money** is a checkable global property, not an accounting convention.

### 4. Reversal is a compensating entry, never a mutation

Undoing a transaction posts a **new balanced `JournalTransaction`** with the opposite legs,
linked to the original. History is immutable ([1](#1-append-only-postings)); the ledger's state
is the fold of all entries, so a reversal is just another fact in the sequence.

## Consequences

### Positive

- **The core invariant is unforgeable** — violating sum-zero requires defeating both a pure
  aggregate and a deferred DB trigger; a direct UPDATE/DELETE is revoked outright.
- **Provable, not asserted** — the pure aggregate is property-tested; conservation of money is a
  single global query the `audit` module ([ADR-001](001-architecture-style.md)) can run.
- **Uniform model** — transfer, deposit, refund, split, and reversal are all the one balanced
  primitive, so there is no special-case code to keep consistent.
- **Full auditability** — append-only history means the ledger is reconstructable and tamper-
  evident by construction.

### Negative / costs

- **No in-place fixes** — every correction is a compensating entry, which operators and reporting
  must understand (a feature for auditability, a learning curve for users).
- **The deferred trigger is hand-written SQL** — part of the correctness surface, so it is
  covered by integration tests (a rejected unbalanced insert, an accepted balanced multi-leg one).
- **The `@world` account is privileged** — its overdraft exemption must be modeled explicitly and
  guarded so it cannot be misused as an ordinary account.

## Alternatives considered

- **Enforce sum-zero only in application code** — rejected: a single query that bypasses the
  domain (migration, admin fix, future module) could write unbalanced rows; the invariant must
  live in the database too.
- **A per-row `CHECK` for the balance** — rejected as impossible: a `CHECK` sees one row and
  cannot sum a transaction's legs; the deferred **constraint trigger** is the only correct SQL
  mechanism for a multi-row invariant.
- **Mutable postings with UPDATE/DELETE for corrections** — rejected: it destroys auditability
  and tamper-evidence; compensating entries preserve history while achieving the same net effect.
- **Model deposits as un-balanced single postings** (no `@world` account) — rejected: it breaks
  the global sum-zero property, so "conservation of money" would no longer be checkable end to
  end. The system account keeps the invariant total.
