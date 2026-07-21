# MiniLedger

> A double-entry financial ledger API — idempotent transfers, concurrency-safe balances, and an immutable audit trail.

**Live:** API [`https://ledger.deviego.xyz`](https://ledger.deviego.xyz) — interactive API docs at [`/docs`](https://ledger.deviego.xyz/docs); `/health`, `/ready`, `/metrics`, and `/docs` are public, every other route needs an AccessCore bearer token. Web **dashboard** [`https://app.ledger.deviego.xyz`](https://app.ledger.deviego.xyz).

## Overview

MiniLedger is a transactional ledger service: money moves between accounts as balanced
double-entry postings, transfers are **idempotent** under retries, balances stay **correct under
concurrency**, and every change is recorded in an **append-only, tamper-evident audit log**. It
authenticates and authorizes through **AccessCore** (the portfolio's IAM flagship) via its SDK —
this project is the SDK's first real consumer.

## Business Problem

The proof of a _critical backend_: moving money must be exactly-once, never lose or invent value,
and stay consistent under concurrent transfers — the elite backend signal (correctness +
concurrency). (Full context in [`docs/business-context.md`](docs/business-context.md).)

## Main Features

- **Idempotent transfers** — an idempotency key makes a retried transfer a no-op, never a double spend.
- **Double-entry postings** — every transaction is a set of postings that sum to zero (the ledger invariant).
- **Concurrency-safe balances** — correct balances under concurrent transfers (ordered `FOR UPDATE` row-locking).
- **Immutable audit log** — append-only, tamper-evident per-account hash chain over every posting.
- **Auth via AccessCore** — AccessCore-issued tokens verified locally; authorization combines the SDK's capability PEP with local account ownership (fail-closed).

## Architecture

Hexagonal modular monolith + DDD, recorded across [`docs/adr/`](docs/adr/) (001–010); detail in
[`docs/architecture.md`](docs/architecture.md).

## Tech Stack

Node.js · NestJS · TypeScript · PostgreSQL · Drizzle ORM · `jose` · `nestjs-pino` · `prom-client` · `@nestjs/swagger` · `@diegowritescode/accesscore-sdk`
(Redis and RabbitMQ enter with later spine projects; idempotency here is Postgres-authoritative.)

## Data Model

Accounts, transactions, postings, and the audit log. Detail in [`docs/data-model.md`](docs/data-model.md).

## Authentication & Authorization

Every route except `/health`, `/ready`, `/metrics`, and `/docs` requires an **AccessCore bearer token**
(`Authorization: Bearer <jwt>`). Authorization is **hybrid**:

- **Authentication** — a local `AccessTokenGuard` verifies the AccessCore EdDSA (Ed25519) token
  **offline** against AccessCore's JWKS (`iss`/`aud`/`exp`/`nbf`, 30 s skew) and attaches the
  principal; no round-trip needed to authenticate.
- **Capability (AccessCore PEP)** — privileged routes forward the token to AccessCore's `check()`
  for `ledger.open` / `ledger.transfer` / `ledger.audit` / `ledger.reverse` on
  `{type:'ledger', id:'miniledger'}`; deny → 403, PDP unreachable → **503 (fail-closed)**.
- **Ownership (local)** — `accounts.owner_id` scopes reads to the caller (a non-owner `GET
/accounts/:id` returns 404, not 403) and requires source-account ownership to transfer (`@world`
  exempt).

**Getting a token in dev.** Mint an AccessCore access token via its login flow, or (as the tests do)
sign a short-lived EdDSA JWT with a keypair whose public JWK is served at `ACCESSCORE_JWKS_URL`, with
`iss = ACCESSCORE_JWT_ISSUER`, `aud = ACCESSCORE_JWT_AUDIENCE`, and `sub` = the granted subject. The
subject must hold the `operator` relation on the `ledger` resource in AccessCore (see the seeding
runbook in [`docs/security.md`](docs/security.md)). Full model in [`docs/security.md`](docs/security.md).

## Testing Strategy

Unit / integration / E2E, with **property-based tests (fast-check)** of the ledger invariants and a
real-Postgres concurrency test of the balance locks. A single **merged** coverage gate (nyc across
all three suites) enforces **90% lines / 90% statements / 85% functions / 75% branches**; the latest
run sits around **~99% lines, ~98% statements, 100% functions, ~86% branches**. See
[`docs/testing-strategy.md`](docs/testing-strategy.md).

## Deployment

Deployed on **Dokploy** at [`https://ledger.deviego.xyz`](https://ledger.deviego.xyz) — a multi-stage
Docker image with migrate-on-start against a managed Postgres, fronted by Traefik TLS. GitHub Actions
runs `lint → typecheck → build → migrate → coverage`. Runbook in [`docs/deployment.md`](docs/deployment.md).

The app runs as a **least-privilege database role** so the append-only ledger binds at runtime
([ADR-011](docs/adr/011-least-privilege-db-role.md)), emits **structured JSON logs** with per-request
correlation ids, and exposes **Prometheus metrics** at `/metrics` ([ADR-012](docs/adr/012-observability.md)).

## Dashboard

A web dashboard lives in [`web/`](web) — a **Next.js backend-for-frontend** deployed alongside the
API at [`https://app.ledger.deviego.xyz`](https://app.ledger.deviego.xyz). It signs in against
**AccessCore** (the browser never holds a token — it is kept in an httpOnly cookie and every call is
proxied server-side) and drives the ledger:

- **Accounts** — open accounts and read balances, formatted per currency.
- **Transfer** — move money with an optional idempotency key; the double-entry receipt shows both legs.
- **Statement** — an account's append-only posting history, cursor-paginated.
- **Integrity** — verifies **conservation of money** (per-currency totals net to zero) and each
  account's **hash chain** (intact, or broken at a known sequence) — the tamper-evidence made visible.

Light theme, English/Spanish. It is a separate deployable (its own image and domain, not a
workspace — [ADR-013](docs/adr/013-web-dashboard.md)); see [`web/README.md`](web/README.md) and the
[deploy runbook](docs/deployment.md#dashboard-web).

## Demo

[`scripts/demo.sh`](scripts/demo.sh) walks the full ledger lifecycle against a running instance —
open accounts, deposit from `@world`, an idempotent retry, a transfer, the statement, a reversal, and
the audit hash-chain + conservation checks:

```bash
BASE_URL=https://ledger.deviego.xyz TOKEN=<accesscore-access-token> ./scripts/demo.sh
```

A real, annotated run against the **live** deployment (authenticated with a genuine AccessCore token)
is captured in [`docs/demo.md`](docs/demo.md) — the end-to-end proof that MiniLedger consumes AccessCore
in production.

## Trade-offs

Key decisions and why. See [`docs/trade-offs.md`](docs/trade-offs.md) and [`docs/adr/`](docs/adr/).

## Future Improvements

Emits domain events for the EventBridge spine project; CQRS read models for reporting.

## How to Run

```bash
cp .env.example .env
docker compose up -d          # full stack (API on :3000 + PostgreSQL on host 5433)
# — or, for hot-reload development, run Postgres only and the app from the host:
docker compose up -d postgres
npm ci                        # installs the AccessCore SDK from public npmjs — no token needed
npm run db:migrate            # apply migrations to the running database
npm run start:dev
```

`docker compose up` boots the whole stack (API + Postgres) from a clean clone. The AccessCore SDK
(`@diegowritescode/accesscore-sdk`) resolves from the **public npm registry with no auth token**, so
that clone needs nothing but Docker. Point the `ACCESSCORE_*` variables (see
[`.env.example`](.env.example)) at a running AccessCore for authenticated requests; `/health` and
`/ready` need no token. A live instance runs at [`https://ledger.deviego.xyz`](https://ledger.deviego.xyz).
