# Demo — end-to-end, live

A real run of [`scripts/demo.sh`](../scripts/demo.sh) against the live deployment at
**`https://ledger.deviego.xyz`**, authenticated with a genuine **AccessCore** access token. It walks
the full ledger lifecycle in nine steps and shows the core invariants holding on production
infrastructure — this is MiniLedger acting as AccessCore's first real consumer, end to end.

## Running it yourself

The script is parameterized by `BASE_URL` and `TOKEN` and needs only `bash`, `curl`, and `jq`:

```bash
BASE_URL=https://ledger.deviego.xyz TOKEN=<accesscore-access-token> ./scripts/demo.sh
```

`TOKEN` must be an AccessCore bearer whose subject holds the `operator` relation on
`{type:"ledger", id:"miniledger"}` — that relation grants the `ledger.open` / `transfer` / `audit` /
`reverse` verbs the routes require (see [security.md](security.md) and
[ADR-009](adr/009-accesscore-integration.md)). Establish it once against your AccessCore instance via
its Policy Admin API:

```bash
# define the `ledger` namespace (operator grants all four verbs)
curl -X PUT  "$AC/authz/namespaces/ledger" -H "Authorization: Bearer $ADMIN" -H 'Content-Type: application/json' \
  -d '{"relations":["operator"],"actions":{"open":["operator"],"transfer":["operator"],"audit":["operator"],"reverse":["operator"]}}'
# grant a subject `operator` on ledger:miniledger
curl -X POST "$AC/authz/tuples"            -H "Authorization: Bearer $ADMIN" -H 'Content-Type: application/json' \
  -d '{"object":{"type":"ledger","id":"miniledger"},"relation":"operator","subject":{"type":"user","id":"<sub>"}}'
```

The transcript below is verbatim output from one such run (account UUIDs are real; no token is ever
printed).

## The walkthrough

### 1 · Liveness & readiness (public — no token)

```json
{ "status": "ok" }
{ "status": "ready" }
```

`/health` is liveness; `/ready` runs a `SELECT 1` against Postgres. Both are the only unauthenticated
routes.

### 2 · Accounts visible to the caller — locate `@world`

```json
[
  {
    "id": "70023411-1a63-4338-ae41-bd3d513e6c73",
    "type": "system",
    "currency": "USD",
    "overdraftFloor": null,
    "createdAt": "2026-07-16T04:00:27.112Z"
  },
  {
    "id": "c3a7f97e-56e0-4654-b6bb-b956cc69c104",
    "type": "system",
    "currency": "EUR",
    "overdraftFloor": null,
    "createdAt": "2026-07-16T04:00:27.112Z"
  },
  {
    "id": "230e8665-42ab-42a2-bc3c-d1b013194f58",
    "type": "system",
    "currency": "JPY",
    "overdraftFloor": null,
    "createdAt": "2026-07-16T04:00:27.112Z"
  }
]
```

The listing is **owner-scoped** (`listVisibleTo`): the caller sees their own accounts plus the
per-currency `@world` system accounts. `@world` has `overdraftFloor: null` — it is overdraft-exempt,
the source of money entering the ledger.

### 3 · Open two USD accounts (A, B)

```json
{ "id": "ed0867b9-3e2c-4b31-b3db-3762ec9c7016", "type": "user", "currency": "USD", "overdraftFloor": "0", "createdAt": "2026-07-16T05:09:32.093Z" }
{ "id": "82df12a9-010a-461d-b977-59620efa35be", "type": "user", "currency": "USD", "overdraftFloor": "0", "createdAt": "2026-07-16T05:09:32.791Z" }
```

`POST /accounts` is capability-gated by `ledger.open` and stamps `owner_id = principal.subject`. User
accounts have `overdraftFloor: "0"` — they cannot go negative.

### 4 · Deposit 1000 from `@world` to A

```json
{
  "id": "4a735a0d-ce0c-43c1-aa7b-74c0f341583a",
  "currency": "USD",
  "postings": [
    { "accountId": "70023411-...-513e6c73", "amount": "-1000", "balanceAfter": "-1000" },
    { "accountId": "ed0867b9-...-3762ec9c7016", "amount": "1000", "balanceAfter": "1000" }
  ]
}
```

**Double-entry**: the transfer is two postings that sum to zero (`-1000 + 1000`). `@world` goes
negative (exempt); A is credited 1000.

### 5 · Retry the SAME deposit (same `Idempotency-Key`)

```json
{
  "id": "4a735a0d-ce0c-43c1-aa7b-74c0f341583a",
  "currency": "USD",
  "postings": [
    { "amount": "-1000", "accountId": "70023411-...-513e6c73", "balanceAfter": "-1000" },
    { "amount": "1000", "accountId": "ed0867b9-...-3762ec9c7016", "balanceAfter": "1000" }
  ]
}
```

**Idempotency**: same `Idempotency-Key` → the **same transaction id** `4a735a0d…` is returned and no
second posting is written. A retried deposit is a no-op, never a double spend.

### 6 · Transfer 300 from A to B

```json
{
  "id": "cc5b98a5-94dc-4fc1-99ba-7d1ad45a6b6c",
  "currency": "USD",
  "postings": [
    { "accountId": "ed0867b9-...-3762ec9c7016", "amount": "-300", "balanceAfter": "700" },
    { "accountId": "82df12a9-...-59620efa35be", "amount": "300", "balanceAfter": "300" }
  ]
}
```

A pays B under an ordered `SELECT … FOR UPDATE` on both balance rows (deadlock-free, overdraft-guarded
on the locked row). A: 1000 → 700; B: 0 → 300.

### 7 · A's statement — history with running balance

```json
{
  "entries": [
    {
      "seq": 2,
      "transactionId": "4a735a0d-...-74c0f341583a",
      "amount": "1000",
      "balanceAfter": "1000",
      "createdAt": "2026-07-16T05:09:33.538Z"
    },
    {
      "seq": 3,
      "transactionId": "cc5b98a5-...-7d1ad45a6b6c",
      "amount": "-300",
      "balanceAfter": "700",
      "createdAt": "2026-07-16T05:09:34.943Z"
    }
  ],
  "nextCursor": null
}
```

Seq-ordered, cursor-paginated, owner-scoped. The `balanceAfter` column is the materialized running
balance recorded at posting time.

### 8 · Reverse the A→B transfer

```json
{
  "id": "d4cd2331-806f-43dd-8da4-47670c8777ba",
  "currency": "USD",
  "postings": [
    { "accountId": "ed0867b9-...-3762ec9c7016", "amount": "300", "balanceAfter": "1000" },
    { "accountId": "82df12a9-...-59620efa35be", "amount": "-300", "balanceAfter": "0" }
  ]
}
```

A reversal is a **new compensating entry** (negated legs), not a mutation — history is append-only.
It is once-only (a `UNIQUE` on `reverses_transaction_id`). A returns to 1000; B to 0.

### 9 · Audit — hash chain & conservation

```json
{ "accountId": "ed0867b9-...-3762ec9c7016", "postingCount": 3, "balance": "1000", "chainValid": true, "headMatches": true, "reconciled": true, "brokenAtSeq": null }
{ "conserved": true, "byCurrency": [ { "currency": "USD", "total": "0" } ] }
```

The read-only verifier recomputes A's per-account **hash chain** (`chainValid`), checks it against the
stored head (`headMatches`), and reconciles the posting sum against the materialized balance
(`reconciled`) — no divergence (`brokenAtSeq: null`). System-wide, money is **conserved**: every USD
posting across all accounts sums to exactly `0`.

## What it proves

| Property                                                                                   | Where in the run  |
| ------------------------------------------------------------------------------------------ | ----------------- |
| Live AccessCore authN + capability authZ (real token, offline JWKS verify + PEP `check()`) | every authed step |
| Double-entry, balanced postings                                                            | 4, 6, 8           |
| Idempotent transfers (no double spend)                                                     | 5                 |
| Concurrency-safe, overdraft-guarded balances (`FOR UPDATE`)                                | 6                 |
| Append-only correction via compensating reversal                                           | 8                 |
| Tamper-evident audit (per-account hash chain) + conservation of money                      | 9                 |
