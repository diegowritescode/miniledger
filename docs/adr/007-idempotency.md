# ADR-007: Idempotent transfers — Postgres-authoritative, same-transaction key claim

- **Status:** Accepted (2026-07-14)
- **Date:** 2026-07-14
- How MiniLedger makes a retried or duplicated transfer exactly-once, not a double spend.

## Context

A money-moving API must survive retries. A client that times out waiting for `POST /transfers`
does not know whether the transfer committed, so it retries — and a naive server would move the
money twice. The standard contract is an **`Idempotency-Key`**: the first request with a given key
executes; any later request with the same key **replays** the first result instead of re-executing.

The hard requirements are:

- **Exactly-once under concurrency.** Two requests carrying the same key may arrive at the same
  instant (a double-click, a retry racing the original). The transfer must happen **once**.
- **Atomic with the transfer.** The idempotency record and the postings/balance updates must
  commit or roll back **together**. If the transfer commits but the key record does not, a retry
  double-spends; if the key commits but the transfer does not, a retry wrongly replays a transfer
  that never happened.
- **A different request under the same key is an error**, not a silent replay of the wrong result.

## Decision

**Idempotency is Postgres-authoritative and claimed inside the same transaction as the transfer**
([ADR-003](003-persistence-and-orm.md)'s unit of work). An `idempotency_keys` table holds the
`key` (primary key), a `fingerprint` of the request, the resulting `transaction_id`, and the
stored `response`.

Per transfer that carries an `Idempotency-Key`, inside one UoW transaction:

1. **Claim.** `INSERT INTO idempotency_keys (key, fingerprint) VALUES (…) ON CONFLICT (key) DO
NOTHING RETURNING key`.
   - **A row is returned** → this request **owns** the key: execute the transfer, then `UPDATE`
     the row with the `transaction_id` and the serialized `response`.
   - **No row is returned** → the key already exists: read it. **Same fingerprint** → **replay**
     the stored response (no re-execution). **Different fingerprint** → **`409 Conflict`**.
2. **Commit** applies the key row and the postings/balances together, under the same deferred
   sum-zero trigger ([ADR-005](005-double-entry-model.md)) and balance locks
   ([ADR-006](006-concurrency-safe-balances.md)).

### Why this is concurrency-safe

The **unique constraint on `key`** is the serialization point. When two transactions insert the
same key, the second `INSERT … ON CONFLICT DO NOTHING` **blocks on the first's uncommitted row**
until it resolves:

- if the owner **commits**, the second sees the committed row (no insert), reads it, and
  **replays** — the transfer ran once;
- if the owner **rolls back**, the row disappears, the second's insert succeeds, and it **takes
  over** and executes.

No application-level lock, no read-modify-write window — the database arbitrates.

### Failure semantics

The key is claimed **inside** the transfer transaction, so a failed transfer (insufficient funds,
unknown account) **rolls back the claim** along with everything else. A later retry therefore
**re-attempts** rather than replaying a stale error — errors are not cached, only committed
outcomes are.

## Consequences

### Positive

- **Exactly-once transfers** under retries and concurrent duplicates, guaranteed by the database.
- **Atomic** — the idempotency record can never disagree with whether the transfer committed,
  because they are the same transaction.
- **Self-serializing** — the unique constraint plus the blocking insert removes the classic
  check-then-act race with no extra locking code.

### Negative / costs

- **Stored responses grow** — the `idempotency_keys` table accumulates rows and cached responses;
  a retention/TTL sweep is a later operational concern, not a correctness one.
- **Errors are not idempotent** — a retried key whose first attempt failed re-executes; acceptable
  and arguably correct (a transient failure should be retryable), but it is a deliberate choice.
- **The key is coupled to one endpoint's response shape** — the stored `response` is the transfer
  receipt; generalizing idempotency across endpoints would need a more abstract envelope.

## Alternatives considered

- **Redis for the idempotency record** — rejected: Redis cannot commit **atomically** with the
  Postgres transfer, so a crash between the Redis write and the Postgres commit (or vice versa)
  reintroduces the exact double-spend / phantom-replay the feature exists to prevent. The record
  must live in the same transactional store as the money.
- **Application-level lock (or `SELECT … FOR UPDATE` on a separate lock row) then check-then-act**
  — rejected as redundant: the unique constraint already serializes, and a blocking `INSERT … ON
CONFLICT` is simpler and has no separate lock to manage.
- **Cache error responses too** — rejected as the default: a `422 insufficient funds` can become
  valid once funds arrive, so replaying it would be wrong; only committed outcomes are stored.
- **A key TTL enforced synchronously on the write path** — deferred: retention is an operational
  sweep, not part of the correctness-critical commit path.
