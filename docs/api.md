# API

## Conventions

- **Base URL** — `http://localhost:3000` in development. **Live: TBD** (a later hardening slice).
- **Content type** — `application/json`. Monetary amounts are **minor-unit `bigint`s serialized as
  strings** (e.g. `"1234"` = `$12.34`), because JSON `number` cannot safely carry them
  ([ADR-004](adr/004-money-representation.md)). A posting's `amount` is **signed**: the source leg
  is negative (money leaving), the destination leg is positive (money arriving); the legs of a
  transaction sum to zero.
- **Authentication** — `Authorization: Bearer <jwt>` on every route except `/health`, `/ready`, and `/metrics`.
  The token is an AccessCore EdDSA access token, verified offline
  ([security.md](security.md#authentication)). Missing/invalid → **401**.
- **Authorization** — privileged routes also require an AccessCore capability
  (`ledger.open`/`ledger.transfer`/`ledger.reverse`/`ledger.audit`) plus, where applicable, local
  account ownership ([security.md](security.md#authorization)).
- **Errors** — **RFC 7807** `application/problem+json`: `{ "type", "title", "status", "detail" }`.
- **Versioning / pagination** — the surface is small and unversioned; list endpoints are unpaged
  (owner-scoped). Both are candidates if the surface grows.

## Endpoints

### `GET /health` — liveness (open)

No auth. Returns `200 { "status": "ok" }`. Always succeeds if the process is up.

### `GET /ready` — readiness (open)

No auth. Runs a `SELECT 1` DB probe. `200 { "status": "ready" }` when Postgres is reachable.

### `GET /metrics` — Prometheus metrics (open)

No auth (scraped in-network). Default Node/process metrics plus an `http_request_duration_seconds`
histogram (labels `method` / `route` / `status_code`). `200 text/plain; version=0.0.4`. See
[ADR-012](adr/012-observability.md).

### `POST /accounts` — open a user account

- **Auth:** Bearer + capability `ledger.open`.
- **Request:** `{ "currency": "USD" }` (supported: `USD`, `EUR`, `JPY`).
- **Behavior:** creates a `user` account owned by the token subject, with overdraft floor `0`, and
  initializes its balance row at `0` in the same transaction.
- **Success:** `201 Created`

  ```json
  {
    "id": "8f1d2c3b-4a5e-6f70-8192-a3b4c5d6e7f8",
    "type": "user",
    "currency": "USD",
    "overdraftFloor": "0",
    "createdAt": "2026-07-14T10:00:00.000Z"
  }
  ```

- **Errors:** `401` unauthenticated · `403` capability denied · `503` PDP unavailable (fail-closed)
  · `422` unknown currency or validation failure.

### `GET /accounts` — list the caller's accounts

- **Auth:** Bearer.
- **Behavior:** returns the caller's own accounts **plus** system accounts (`@world`). Other users'
  accounts are never listed.
- **Success:** `200` — an array of the account object shown above.
- **Errors:** `401`.

### `GET /accounts/:id` — fetch one account

- **Auth:** Bearer.
- **Behavior:** returns the account only if the caller owns it or it is a system account.
- **Success:** `200` — the account object above.
- **Errors:** `401` · **`404`** when the account does not exist **or** the caller is not the owner
  (existence is not leaked — see [anti-IDOR](security.md#ownership-check--local-per-resource-anti-idor)).

> The account object carries metadata, not the live balance. Balances surface on transfer receipts
> (`balanceAfter`), on the statement below, and in the audit report (`GET /audit/accounts/:id`).

### `GET /accounts/:id/statement` — paginated posting history

- **Auth:** Bearer (owner-scoped like `GET /accounts/:id`).
- **Query:** `limit` (1–200, default 50) and `cursor` (a `seq`); returns the account's postings in
  `seq` order after the cursor.
- **Success:** `200`

  ```json
  {
    "entries": [
      {
        "seq": 12,
        "transactionId": "…",
        "amount": "1000",
        "balanceAfter": "1000",
        "createdAt": "…Z"
      },
      {
        "seq": 15,
        "transactionId": "…",
        "amount": "-300",
        "balanceAfter": "700",
        "createdAt": "…Z"
      }
    ],
    "nextCursor": 15
  }
  ```

  `nextCursor` is the `seq` to pass as `cursor` for the next page, or `null` on the last page.

- **Errors:** `401` · **`404`** when the account does not exist or the caller is not the owner.

### `POST /transfers` — move money between accounts

- **Auth:** Bearer + capability `ledger.transfer` + **ownership of the source account** (`@world`
  exempt).
- **Headers:** `Idempotency-Key: <opaque string>` (optional but recommended — makes a retry
  exactly-once, [ADR-007](adr/007-idempotency.md)).
- **Request:**

  ```json
  {
    "from": "00000000-0000-0000-0000-00000000w0rld",
    "to": "8f1d2c3b-4a5e-6f70-8192-a3b4c5d6e7f8",
    "amount": "5000",
    "currency": "USD"
  }
  ```

  `from`/`to` are account UUIDs, `amount` is a **positive** minor-unit integer string, `currency`
  must match both accounts. (A deposit is a transfer whose `from` is the `@world` account for that
  currency.)

- **Success:** `201 Created` — a receipt with one line per leg (source negative, destination
  positive), replayed verbatim on a duplicate `Idempotency-Key`:

  ```json
  {
    "id": "c1a2b3d4-e5f6-7081-92a3-b4c5d6e7f8a9",
    "currency": "USD",
    "postings": [
      {
        "accountId": "00000000-0000-0000-0000-00000000w0rld",
        "amount": "-5000",
        "balanceAfter": "-5000"
      },
      {
        "accountId": "8f1d2c3b-4a5e-6f70-8192-a3b4c5d6e7f8",
        "amount": "5000",
        "balanceAfter": "5000"
      }
    ]
  }
  ```

- **Errors (RFC 7807):**

  | Status | Condition                                                                                                   |
  | ------ | ----------------------------------------------------------------------------------------------------------- |
  | `401`  | unauthenticated                                                                                             |
  | `403`  | capability denied, **or** caller does not own the source account (`not_account_owner`)                      |
  | `404`  | `from` or `to` account does not exist (`unknown_account`)                                                   |
  | `409`  | `Idempotency-Key` reused with a **different** request body (`idempotency_conflict`)                         |
  | `422`  | insufficient funds; non-positive amount; same source and destination; currency mismatch; validation failure |
  | `503`  | AccessCore PDP unavailable (**fail-closed**)                                                                |

### `POST /reversals` — reverse (compensate) a transaction

- **Auth:** Bearer + capability `ledger.reverse`. Reversal is **capability-gated, not
  ownership-gated** — it posts a compensating entry through the same locked path as a transfer but
  skips the source-ownership check, so an authorized operator can reverse any transaction (including
  a deposit from `@world`).
- **Behavior:** loads the original transaction and posts a **new balanced transaction whose legs are
  the original's negated** ([ADR-005](adr/005-double-entry-model.md) §4). History is never mutated;
  the compensating entry records the original's id in `reverses_transaction_id`, and a
  `transfer.reversed` event is written to the outbox in the same transaction
  ([ADR-010](adr/010-transactional-outbox.md)).
- **Request:**

  ```json
  { "transactionId": "c1a2b3d4-e5f6-7081-92a3-b4c5d6e7f8a9" }
  ```

- **Success:** `201 Created` — a receipt in the same shape as a transfer, with the compensating
  (negated) legs and each account's `balanceAfter` after the reversal.
- **Errors (RFC 7807):**

  | Status | Condition                                                                                                           |
  | ------ | ------------------------------------------------------------------------------------------------------------------- |
  | `401`  | unauthenticated                                                                                                     |
  | `403`  | capability denied                                                                                                   |
  | `404`  | the transaction does not exist (`unknown_transaction`)                                                              |
  | `409`  | the transaction has already been reversed (`already_reversed` — the `UNIQUE` reversal constraint)                   |
  | `422`  | the reversal would overdraw an account whose funds were already moved on (`insufficient_funds`); validation failure |
  | `503`  | AccessCore PDP unavailable (**fail-closed**)                                                                        |

### `GET /audit/accounts/:id` — verify one account

- **Auth:** Bearer + capability `ledger.audit`.
- **Behavior:** recomputes the account's hash chain and reconciles it against the materialized
  balance ([ADR-008](adr/008-audit-hash-chain.md)).
- **Success:** `200`

  ```json
  {
    "accountId": "8f1d2c3b-4a5e-6f70-8192-a3b4c5d6e7f8",
    "postingCount": 3,
    "balance": "5000",
    "chainValid": true,
    "headMatches": true,
    "reconciled": true,
    "brokenAtSeq": null
  }
  ```

  `chainValid` = every recomputed hash matches; `headMatches` = the last posting's hash equals
  `account_balances.chain_hash`; `reconciled` = `balance == SUM(postings) == last balanceAfter`;
  `brokenAtSeq` = the `seq` of the first diverging posting, or `null`.

- **Errors:** `401` · `403` · `404` unknown account · `503`.

### `GET /audit/conservation` — verify conservation of money

- **Auth:** Bearer + capability `ledger.audit`.
- **Behavior:** sums all postings per currency; a healthy ledger nets to zero everywhere
  ([ADR-005](adr/005-double-entry-model.md)).
- **Success:** `200`

  ```json
  {
    "conserved": true,
    "byCurrency": [
      { "currency": "EUR", "total": "0" },
      { "currency": "JPY", "total": "0" },
      { "currency": "USD", "total": "0" }
    ]
  }
  ```

- **Errors:** `401` · `403` · `503`.

## Collection

The HTTP contract is exercised end-to-end by the e2e suite (`test/*.e2e-spec.ts` — accounts,
transfers, audit, and the PEP), which doubles as executable request/response examples. A
Postman/Newman collection is a planned addition.
