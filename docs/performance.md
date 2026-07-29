# MiniLedger — Performance

A claim like "transfers are fast" is worthless without a number, a method, and the conditions it
was measured under. This document records a reproducible load test of the transfer hot path and,
more importantly, **what the numbers mean** — the concurrency model is the whole story here.

## What is measured

`POST /transfers` — the money path. Each request is authenticated (offline JWKS), authorized by
the AccessCore PEP (`ledger.transfer`), then executed as a double-entry posting: an ordered
`SELECT … FOR UPDATE` on both accounts, a sum-zero deferred constraint trigger, the per-account
hash-chain append, and a transactional-outbox write — all in one transaction.

Every request is a genuinely new 1-unit posting (no `Idempotency-Key`), so nothing is a dedup
no-op. Two load shapes are run to isolate the concurrency behaviour:

- **Hot account** — all VUs debit the _same_ source account. Writes serialize on that one
  account's row lock: the worst case.
- **Sharded** — each VU debits its _own_ account. Writes hit distinct row locks: the throughput
  ceiling when load is spread across accounts.

## Method

- **Tool:** [k6](https://k6.io) — [`perf/transfer.k6.js`](../perf/transfer.k6.js) (hot account by
  default; pass `ACCOUNTS='[...]'` for the sharded shape).
- **Profile:** 30 constant VUs, 20 s.
- **Harness:** `docker compose up` (Postgres 16) + the API as a local Node process, with the
  AccessCore PEP pointed at a local AccessCore instance — so the numbers include the **real
  cross-service authorization hop**, not a stub. Rate limiting is raised for the run; it is
  exercised by its own tests.
- **Environment:** a developer laptop (Apple Silicon, 10 cores, 16 GB), API + Postgres + AccessCore
  all on one host. These are **relative** figures and a reproducible method, not a production
  hardware benchmark.

Reproduce (with an AccessCore instance and a token that holds `ledger.transfer`):

```bash
docker compose up -d postgres
npm run build && npm run db:migrate
# start the API on :3100 pointed at AccessCore, open + fund a couple of accounts, then:
TOKEN=… FROM=<accountA> TO=<accountB> npm run perf
```

## Results

Measured on the environment above (single run each, 0.00% HTTP errors, every response `201`):

| Shape                                               | p50   | p95   | p99   | max    | Throughput |
| --------------------------------------------------- | ----- | ----- | ----- | ------ | ---------- |
| Hot account (all VUs → one source, lock-serialized) | 57 ms | 70 ms | 86 ms | 144 ms | ~512 tx/s  |
| Sharded (each VU → its own source)                  | 29 ms | 39 ms | 51 ms | 148 ms | ~999 tx/s  |

The k6 threshold (`transfer` p95 < 150 ms, error rate < 1%) passes, so the script doubles as a
local regression gate.

## What the numbers mean

- **The lock is per-account, and that is the design working as intended.** Sharding the load
  across accounts roughly **doubles throughput (512 → 999 tx/s) and halves latency** versus a
  single hot account. Under the hot-account shape the extra latency is not work — it is VUs
  _queuing_ on one account's `FOR UPDATE` lock. Correctness (no lost update, no double-spend, no
  deadlock via the ordered lock acquisition) is preserved in both shapes; only the contended
  account pays the serialization cost. A real ledger scales by spreading activity across many
  accounts, which is exactly what the sharded number shows.
- **Most of a transfer's latency is the authorization hop, not the posting.** The sharded p50
  (~29 ms) is close to AccessCore's own `check` p50 (~22 ms, see AccessCore's `docs/performance.md`)
  — the double-entry posting itself is only ~7 ms. If transfer latency ever needed to drop, the
  lever is the PEP round-trip (short-TTL decision caching in the SDK), not the ledger transaction.

## Why this is not a CI gate

The k6 script carries thresholds and is meant to be run locally or on demand against a
`docker compose` stack. It is intentionally **not** wired into `verify`: shared CI runners have
non-deterministic CPU/IO, which turns latency thresholds into flakes and makes absolute numbers
meaningless. Performance here is a property to measure deliberately and reason about, not a
per-commit pass/fail.
