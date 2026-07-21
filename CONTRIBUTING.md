# Contributing to MiniLedger

Thanks for your interest. This document covers local setup and the conventions the project
enforces.

## Prerequisites

- Node.js ≥ 22 (see `.nvmrc`)
- npm (this is a single-package repo — no pnpm/workspaces)
- Docker (for PostgreSQL)

## Setup

```bash
cp .env.example .env
docker compose up -d postgres   # PostgreSQL on host port 5433
npm ci
npm run db:migrate
npm run start:dev
```

The `@diegowritescode/accesscore-sdk` dependency installs from the **public npm registry with no
token**, so a clean clone runs with nothing more than a database. Point the `ACCESSCORE_*` variables
at a running AccessCore for authenticated requests.

The **dashboard** lives in [`web/`](web) as a separate app with its own tooling:

```bash
cd web && npm ci && npm run dev   # http://localhost:3002
```

## Workflow (trunk-based)

- `main` is always releasable and protected (CI must pass).
- Work on short-lived branches: `feat/…`, `fix/…`, `docs/…` — ideally one vertical slice.
- Open a PR; CI runs the API job (`lint → typecheck → build → migrate → coverage`) and the `web`
  job (`lint → typecheck → build`). Merge with a squash commit.

## Commit conventions

[Conventional Commits](https://www.conventionalcommits.org/) are enforced by commitlint:
`feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `chore:`, `perf:`, `build:`, `ci:`.

## Quality gates

- **pre-commit** — `lint-staged` (ESLint + Prettier on staged files)
- **commit-msg** — commitlint
- **CI** — the full pipeline against a real Postgres service, enforcing the **merged** `nyc`
  coverage gate (90% lines / 90% statements / 85% functions / 75% branches). The gate only ratchets
  up.

## Testing

Unit, integration, and E2E, with property-based tests (`fast-check`) of the ledger invariants and a
real-Postgres concurrency test of the balance locks:

```bash
npm test                 # unit
npm run test:int         # integration (needs Postgres)
npm run test:e2e         # E2E (needs Postgres)
npm run coverage         # merged gate — what CI enforces
```

## Design first

Non-trivial changes should be reflected in `docs/` and, for meaningful decisions, an ADR
(`docs/adr/`). Documentation discipline is a core value of this project.
