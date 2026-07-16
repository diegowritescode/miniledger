# Deployment

MiniLedger is a single Node.js process fronting PostgreSQL, packaged as a multi-stage Docker image
that **applies migrations on start**. It authenticates and authorizes through AccessCore via the
public `@diegowritescode/accesscore-sdk`, which installs from **npmjs with no token** — so a clean
clone runs with nothing more than a database.

## Environments

| Environment    | What differs                                                                                                                                                                                                                            |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Local dev**  | Postgres via `docker compose` on **host port 5433**; app run with `npm run start:dev`. `ACCESSCORE_*` point at a local or shared AccessCore.                                                                                            |
| **CI**         | Postgres **service container** on `5432`; migrations applied with `drizzle-kit`; the merged coverage gate runs.                                                                                                                         |
| **Production** | Runs on **Dokploy** at **`https://ledger.deviego.xyz`** from the runtime image against a Dokploy-managed Postgres; `migrate-on-start` applies pending migrations, then boots the API. See [Production — Dokploy](#production--dokploy). |

## Local run

```bash
cp .env.example .env
docker compose up -d postgres   # starts PostgreSQL on host port 5433 (see docker-compose.yml)
npm ci                          # installs deps incl. the AccessCore SDK from public npmjs (no token)
npm run db:migrate              # apply migrations to the running database
npm run start:dev
```

`docker-compose.yml` provisions **PostgreSQL** (`postgres:16-alpine`, host `5433` → container `5432`,
with a `pg_isready` healthcheck and a named volume) **and the API** (built from the `Dockerfile`, gated
on a healthy database, migrate-on-start, served on `:3000`). A bare `docker compose up` therefore boots
the **whole stack** from a clean clone; for hot-reload development, start Postgres only
(`docker compose up -d postgres`) and run the app with `npm run start:dev`. Redis and RabbitMQ are
**not** used yet — idempotency is Postgres-authoritative ([ADR-007](adr/007-idempotency.md)) and
messaging arrives with the EventBridge spine project.

## Docker image

`Dockerfile` is a three-stage build (`node:22-alpine`):

1. **`deps`** — `npm ci` from `package.json` + `package-lock.json` (cache-friendly layer).
2. **`build`** — `npm run build`, then `npm prune --omit=dev` to drop dev dependencies.
3. **`runtime`** — copies `dist/`, pruned `node_modules/`, and the `drizzle/` migrations; runs as the
   non-root `node` user; entrypoint:

   ```dockerfile
   CMD ["sh", "-c", "node dist/migrate.js && node dist/main.js"]
   ```

`dist/migrate.js` is the **`drizzle-orm` programmatic migrator** — a lean runtime step, not the
`drizzle-kit` CLI ([ADR-003](adr/003-persistence-and-orm.md)): the production container never ships
or invokes the generator, and the schema is only ever the sum of applied migrations (no
`synchronize`).

## Pipeline

`.github/workflows/ci.yml` runs on every push to `main` and every pull request, against a Postgres
service container:

```
npm ci → lint → typecheck → build → db:migrate → coverage
```

- `db:migrate` (`drizzle-kit migrate`) applies migrations against the CI Postgres before tests, so
  the integration and e2e suites run on a real, migrated schema.
- `coverage` runs the unit, integration, and e2e suites and enforces the **merged** `nyc` gate —
  see [testing-strategy.md](testing-strategy.md). CI fails on lint, type, build, migration, or
  coverage-threshold errors.

## Configuration

All configuration is environment-driven and validated by a zod schema at boot (`src/config/env.ts`);
an invalid environment fails fast. See [`.env.example`](../.env.example).

| Variable                        | Default                                       | Purpose                                                |
| ------------------------------- | --------------------------------------------- | ------------------------------------------------------ |
| `NODE_ENV`                      | `development`                                 | Runtime mode.                                          |
| `PORT`                          | `3000`                                        | HTTP port.                                             |
| `DATABASE_URL`                  | —                                             | Postgres connection string (host `5433` in dev).       |
| `ACCESSCORE_BASE_URL`           | `http://localhost:3001`                       | AccessCore API base — the PEP forwards `check()` here. |
| `ACCESSCORE_JWKS_URL`           | `http://localhost:3001/.well-known/jwks.json` | Public JWKS for offline token verification.            |
| `ACCESSCORE_JWT_ISSUER`         | `https://auth.accesscore.dev`                 | Required `iss` claim.                                  |
| `ACCESSCORE_JWT_AUDIENCE`       | `accesscore`                                  | Required `aud` claim.                                  |
| `ACCESSCORE_CLOCK_SKEW_SECONDS` | `30`                                          | Allowed `exp`/`nbf` skew.                              |
| `ACCESSCORE_CHECK_TIMEOUT_MS`   | `3000`                                        | PEP `check()` timeout (a slow PDP fails closed → 503). |

`POSTGRES_USER`/`POSTGRES_PASSWORD`/`POSTGRES_DB` configure the compose Postgres. No secret is ever
committed; the real `.env` is git-ignored.

### The AccessCore SDK dependency — clone-and-run

`@diegowritescode/accesscore-sdk` is a **normal npm dependency** published to the **public npm
registry**, so `npm ci` and `docker compose`/image builds resolve it with **no auth token and no
private-registry `.npmrc`**. This is a deliberate operational property: the clone-and-run contract
of the portfolio quality bar holds without any AccessCore credentials.

Publishing the SDK is a **cross-repo AccessCore concern**, out of scope for this repo. It should use
npm **Trusted Publishing (OIDC)** from AccessCore's CI — classic/automation tokens are deprecated —
per AccessCore
[ADR-017](https://github.com/diegowritescode/accesscore/blob/main/docs/adr/017-sdk-packaging-and-publishing.md).

## Production — Dokploy

MiniLedger runs on [Dokploy](https://dokploy.com/) at **`https://ledger.deviego.xyz`**, deployed from
this GitHub repository with a **managed Postgres** service (app and data have independent lifecycles).

1. **Database** — create a **PostgreSQL** service in Dokploy; its owner connection string becomes
   `MIGRATION_DATABASE_URL`. Then create the least-privilege runtime role once ([ADR-011](adr/011-least-privilege-db-role.md)):
   `CREATE ROLE miniledger_app LOGIN PASSWORD '<strong-password>';` — its connection string becomes
   `DATABASE_URL`. Migration 0010 grants that role the minimum on the first migrate.
2. **Application** — create an **Application** from the `diegowritescode/miniledger` repo, **Docker
   (Dockerfile)** build. The image applies migrations on start (`node dist/migrate.js`) before booting,
   so the first deploy provisions the schema with no manual step.
3. **Environment** — set the variables below. No AccessCore service credential is needed: the PEP
   **forwards the caller's own access token** to AccessCore on each `check()`
   (`@diegowritescode/accesscore-sdk`), so `ACCESSCORE_BASE_URL` is the only integration wiring.
4. **Domain** — map **`ledger.deviego.xyz`** to the app on container port **3000** with Dokploy's
   Traefik TLS. The app sets `trust proxy`, so it honours the proxy's `X-Forwarded-*`.
5. **Deploy** — trigger the build. Verify `GET /health` and `GET /ready` return `200`.

| Variable                        | Production value                                 | Notes                                                  |
| ------------------------------- | ------------------------------------------------ | ------------------------------------------------------ |
| `NODE_ENV`                      | `production`                                     |                                                        |
| `PORT`                          | `3000`                                           | Container port mapped by the Dokploy domain.           |
| `DATABASE_URL`                  | _(the `miniledger_app` role)_                    | Least-privilege runtime role (ADR-011).                |
| `MIGRATION_DATABASE_URL`        | _(the owner role)_                               | Runs DDL migrations; falls back to `DATABASE_URL`.     |
| `ACCESSCORE_BASE_URL`           | `https://auth.deviego.xyz`                       | Live AccessCore; the PEP forwards `check()` here.      |
| `ACCESSCORE_JWKS_URL`           | `https://auth.deviego.xyz/.well-known/jwks.json` | Offline token verification (Ed25519/EdDSA).            |
| `ACCESSCORE_JWT_ISSUER`         | `https://auth.deviego.xyz`                       | Must equal the deployed AccessCore's `iss` claim.      |
| `ACCESSCORE_JWT_AUDIENCE`       | `accesscore`                                     | Must equal the deployed AccessCore's `aud` claim.      |
| `ACCESSCORE_CLOCK_SKEW_SECONDS` | `30`                                             | Allowed `exp`/`nbf` skew.                              |
| `ACCESSCORE_CHECK_TIMEOUT_MS`   | `3000`                                           | PEP `check()` timeout — a slow PDP fails closed → 503. |

> `ACCESSCORE_JWT_ISSUER` must equal the deployed AccessCore's `iss` claim — the live instance issues
> `https://auth.deviego.xyz` (its domain), not the code default `https://auth.accesscore.dev`; a
> mismatch fails offline verification with 401. A protected call also requires the caller's subject to
> hold the matching `ledger.*` permission in AccessCore on `{type: "ledger", id: "miniledger"}`.

## Rollback & observability

- **Rollback** — deploy the previous image tag. Migrations are **additive/forward-only** (append-only
  postings, `REVOKE`, the deferred trigger); there is no destructive down-migration path, so a schema
  rollback would be a deliberate, reviewed forward migration.
- **Health** — `GET /health` (liveness) and `GET /ready` (a `SELECT 1` readiness probe) back
  orchestrator checks; `docker-compose` uses `pg_isready` for the database.
- **Observability** — structured JSON logs (`nestjs-pino`) with a per-request correlation id
  (`x-request-id`, echoed on the response) and a redacted `Authorization` header; Prometheus metrics
  at `GET /metrics` (default Node/process metrics plus an `http_request_duration_seconds` histogram —
  the RED signals per route). See [ADR-012](adr/012-observability.md).

## Deferred hardening

- **Distributed tracing** — OpenTelemetry, to adopt alongside a collector and propagate the
  correlation id as the trace id; structured logs and Prometheus metrics ship today
  ([ADR-012](adr/012-observability.md)).
