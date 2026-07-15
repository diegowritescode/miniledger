# ADR-010: Domain events via a transactional outbox

- **Status:** Accepted (2026-07-15)
- **Date:** 2026-07-15
- How MiniLedger emits domain events without ever letting an event disagree with the money.

## Context

MiniLedger will feed downstream consumers — first the **EventBridge** spine project (project #3),
later CQRS read models — with domain events (`transfer.posted`, `transfer.reversed`, …). The
hazard is the **dual-write problem**: if the ledger commits the money to Postgres and then
publishes an event to a broker as a second step, a crash between the two produces either a
**phantom event** (published, but the transaction rolled back) or a **lost event** (committed, but
never published). For a ledger, both are corruption — a reporting read model or a notification
service would diverge from the source of truth.

The event must therefore be produced **atomically with the postings and balance updates**, under
the same unit of work ([ADR-003](003-persistence-and-orm.md)) that already guarantees the transfer
commits or rolls back as a whole ([ADR-006](006-concurrency-safe-balances.md)).

## Decision

**Write domain events to an `outbox` table inside the same database transaction as the ledger
write; a separate relay publishes them afterwards and marks them published.**

- **`outbox` table** — `id`, `type` (the event name), `payload` (`jsonb`), `created_at`, and
  `published_at` (`NULL` until relayed). The row is inserted through the opaque-`Tx` unit of work,
  so it commits or rolls back **with** the postings — no event can exist for a transfer that did
  not happen, and no committed transfer can lack its event.
- **The write path emits.** `TransferService` appends a `transfer.posted` event (payload = the
  transfer receipt) in the transfer transaction; the reversal path
  ([ADR-005](005-double-entry-model.md) §4) will append `transfer.reversed` the same way. The
  domain/application decides _what_ happened; the outbox is how it is recorded durably.
- **The relay is a separate, later concern.** A poller reads unpublished rows (`published_at IS
NULL`) in order, publishes each to the broker, and stamps `published_at` — at-least-once
  delivery, so consumers must be idempotent. **MiniLedger writes the outbox now and defers the
  relay to the EventBridge project**; until then the events accumulate durably, which is harmless
  and is exactly the seam that project plugs into. Ordering and a retention sweep are relay
  concerns, not part of the correctness-critical commit path.

## Consequences

### Positive

- **No dual-write, no phantom/lost events** — the event and the money are one transaction, so a
  consumer's view can always be reconciled against the ledger.
- **The broker is off the write path** — a transfer does not depend on the broker being up; only
  the (later, retryable) relay does. Availability of the money path is unaffected.
- **A clean seam** — EventBridge (and CQRS read models) attach to `outbox` without reshaping the
  domain; the write path already produces the events.

### Negative / costs

- **At-least-once, not exactly-once** — the relay may publish a row twice (crash after publish,
  before the `published_at` write), so **consumers must dedupe** by event id. Standard for the
  pattern.
- **The table grows** — published rows need a retention/archival sweep; an operational concern,
  not a correctness one, deferred with the relay.
- **Polling latency** — a poller adds delay versus a push; acceptable here, and upgradeable to
  `LISTEN/NOTIFY`-triggered polling if latency ever matters.

## Alternatives considered

- **Dual-write: commit Postgres, then publish to the broker** — rejected: no atomicity, so a crash
  between the two corrupts downstream state with a phantom or lost event. This is the exact failure
  the outbox exists to prevent.
- **Change Data Capture (Debezium/logical replication)** — valid and truly log-based, but it adds
  a Kafka-Connect-class component and couples consumers to the physical `postings` schema rather
  than to intentional domain events. Heavier than this scale needs; the outbox keeps events as a
  first-class, versioned contract.
- **Postgres `LISTEN/NOTIFY` alone** — rejected as the store: notifications are **not durable** (a
  disconnected listener misses them), so it cannot be the source of delivery — only, at most, a
  latency optimization on top of the durable outbox.
- **Emit from application code after commit** — rejected: it is the dual-write in disguise, with
  the same phantom/lost-event window.
