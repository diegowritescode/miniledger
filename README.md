# MiniLedger

> A double-entry financial ledger API — idempotent transfers, concurrency-safe balances, and an immutable audit trail.

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

Hexagonal modular monolith + DDD, recorded across [`docs/adr/`](docs/adr/) (001–009); detail in
[`docs/architecture.md`](docs/architecture.md).

## Tech Stack

Node.js · NestJS · TypeScript · PostgreSQL · Drizzle ORM · `jose` · `@diegowritescode/accesscore-sdk`
(Redis and RabbitMQ enter with later spine projects; idempotency here is Postgres-authoritative.)

## Data Model

Accounts, transactions, postings, and the audit log. Detail in [`docs/data-model.md`](docs/data-model.md).

## Authentication & Authorization

Every route except `/health` and `/ready` requires an **AccessCore bearer token**
(`Authorization: Bearer <jwt>`). Authorization is **hybrid**:

- **Authentication** — a local `AccessTokenGuard` verifies the AccessCore EdDSA (Ed25519) token
  **offline** against AccessCore's JWKS (`iss`/`aud`/`exp`/`nbf`, 30 s skew) and attaches the
  principal; no round-trip needed to authenticate.
- **Capability (AccessCore PEP)** — privileged routes forward the token to AccessCore's `check()`
  for `ledger.open` / `ledger.transfer` / `ledger.audit` on `{type:'ledger', id:'miniledger'}`;
  deny → 403, PDP unreachable → **503 (fail-closed)**.
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

Multi-stage Docker image with migrate-on-start; GitHub Actions (`lint → typecheck → build →
migrate → coverage`). **Live: TBD.** See [`docs/deployment.md`](docs/deployment.md).

## Trade-offs

Key decisions and why. See [`docs/trade-offs.md`](docs/trade-offs.md) and [`docs/adr/`](docs/adr/).

## Future Improvements

Emits domain events for the EventBridge spine project; CQRS read models for reporting.

## How to Run

```bash
cp .env.example .env
docker compose up -d      # PostgreSQL on host port 5433 (see docker-compose.yml)
npm ci                    # installs the AccessCore SDK from public npmjs — no token needed
npm run db:migrate        # apply migrations to the running database
npm run start:dev
```

The AccessCore SDK (`@diegowritescode/accesscore-sdk`) resolves from the **public npm registry with
no auth token**, so a clean clone runs with nothing but a database. Point the `ACCESSCORE_*`
variables (see [`.env.example`](.env.example)) at a running AccessCore for authenticated requests;
`/health` and `/ready` need no token. **Live: TBD.**
