# MiniLedger

> A double-entry financial ledger API — idempotent transfers, concurrency-safe balances, and an immutable audit trail.

## Overview
MiniLedger is a transactional ledger service: money moves between accounts as balanced
double-entry postings, transfers are **idempotent** under retries, balances stay **correct under
concurrency**, and every change is recorded in an **append-only, tamper-evident audit log**. It
authenticates and authorizes through **AccessCore** (the portfolio's IAM flagship) via its SDK —
this project is the SDK's first real consumer.

## Business Problem
The proof of a *critical backend*: moving money must be exactly-once, never lose or invent value,
and stay consistent under concurrent transfers — the elite backend signal (correctness +
concurrency). (Full context in [`docs/business-context.md`](docs/business-context.md).)

## Main Features
- **Idempotent transfers** — an idempotency key makes a retried transfer a no-op, never a double spend.
- **Double-entry postings** — every transaction is a set of postings that sum to zero (the ledger invariant).
- **Concurrency-safe balances** — correct balances under concurrent transfers (serializable / row-locking).
- **Immutable audit log** — append-only, tamper-evident history of every posting.
- **Authorization via AccessCore** — authn/authz delegated to AccessCore through its SDK (fail-closed PEP).

## Architecture
Hexagonal modular monolith + DDD (to be recorded in [`docs/adr/`](docs/adr/)); detail in
[`docs/architecture.md`](docs/architecture.md).

## Tech Stack
Node.js · NestJS · TypeScript · PostgreSQL · Redis · `@diegowritescode/accesscore-sdk`
(RabbitMQ arrives with the EventBridge integration, a later spine project.)

## Data Model
Accounts, transactions, postings, and the audit log. Detail in [`docs/data-model.md`](docs/data-model.md).

## Security
Authentication and authorization are delegated to AccessCore via its SDK (fail-closed). See
[`docs/security.md`](docs/security.md).

## Testing Strategy
Unit / integration / E2E, with property-based tests of the ledger invariants. **Coverage: TBD.**
See [`docs/testing-strategy.md`](docs/testing-strategy.md).

## Deployment
Docker, CI/CD, environments. **Live: TBD.** See [`docs/deployment.md`](docs/deployment.md).

## Trade-offs
Key decisions and why. See [`docs/trade-offs.md`](docs/trade-offs.md) and [`docs/adr/`](docs/adr/).

## Future Improvements
Emits domain events for the EventBridge spine project; CQRS read models for reporting.

## How to Run
```bash
cp .env.example .env
docker compose up -d      # Postgres, Redis, RabbitMQ
npm install
npm run start:dev
```
