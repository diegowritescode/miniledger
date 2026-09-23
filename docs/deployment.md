# Deployment

MiniLedger is a single Node.js process fronting PostgreSQL, packaged as a multi-stage Docker image
that **applies migrations on start**. It authenticates and authorizes through AccessCore via the
public `@diegowritescode/accesscore-sdk`, which installs from **npmjs with no token** — so a clean
clone runs with nothing more than a database.

## Environments

| Environment    | What differs                                                                                                                                                                                                                    |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Local dev**  | Postgres via `docker compose` on **host port 5433**; app run with `npm run start:dev`. `ACCESSCORE_*` point at a local or shared AccessCore.                                                                                    |
| **CI**         | Postgres **service container** on `5432`; migrations applied with `drizzle-kit`; the merged coverage gate runs.                                                                                                                 |
| **Production** | Immutable GHCR images run by `deploy/compose.yml` behind Traefik at **`https://ledger.deviego.xyz`**; `migrate-on-start` applies pending migrations, then boots the API. See [Production](#production--compose-behind-traefik). |

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
| `LOG_LEVEL`                     | `info`                                        | pino log level (`fatal`…`trace`, or `silent`).         |
| `THROTTLE_TTL_SECONDS`          | `60`                                          | Rate-limit window length.                              |
| `THROTTLE_LIMIT`                | `100`                                         | Max requests per window per client.                    |

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

## Production — Compose behind Traefik

MiniLedger runs at **`https://ledger.deviego.xyz`** (API) and **`https://app.ledger.deviego.xyz`**
(dashboard) as immutable GHCR images, started by [`deploy/compose.yml`](../deploy/compose.yml)
behind the host's shared Traefik ([ADR-014](adr/014-container-release-and-shared-edge-deployment.md)).
The host never builds: the `Release` workflow publishes `miniledger-api` and `miniledger-web` under
the commit SHA after `CI` passes on `main`.

```
                      ┌──────────── edge (external network) ────────────┐
  :443 ──► Traefik ───┤   api  (ledger.*)          web  (app.ledger.*)   │
                      └────┬─────────────────────────┬──────────────────┘
                           │   internal (private)    │
                        postgres                     └──► api
  api ──► https://auth.deviego.xyz  (AccessCore: JWKS + check, public contract)
```

**Prerequisites:** Docker Compose, a Traefik v3 on the host with an `le` certificate resolver and
an external `edge` network it is attached to, DNS `A` records for both hostnames, and a running
AccessCore.

```bash
git clone https://github.com/diegowritescode/miniledger.git /opt/portfolio/miniledger
cd /opt/portfolio/miniledger/deploy
cp .env.example .env && chmod 600 .env   # secrets: openssl rand -hex 32; tag = release SHA
docker compose pull && docker compose up -d
```

On first boot Postgres creates the least-privilege `miniledger_app` role
([ADR-011](adr/011-least-privilege-db-role.md)); the API applies migrations as the owner, then
serves as `miniledger_app`. No AccessCore credential is needed: the PEP forwards the caller's own
access token on each `check()`.

| Variable (`deploy/.env`) | Example                        | Notes                                               |
| ------------------------ | ------------------------------ | --------------------------------------------------- |
| `MINILEDGER_IMAGE_TAG`   | _(commit SHA)_                 | Immutable image tag; rollback = previous SHA.       |
| `API_HOST` / `WEB_HOST`  | `ledger.deviego.xyz` / `app.…` | Traefik routes and certificates.                    |
| `ACCESSCORE_URL`         | `https://auth.deviego.xyz`     | Base URL, JWKS, and required `iss` all derive here. |
| `POSTGRES_PASSWORD`      | _(secret)_                     | Owner role; runs migrations.                        |
| `APP_DB_PASSWORD`        | _(secret)_                     | Runtime role `miniledger_app`.                      |

> `ACCESSCORE_URL` must equal the deployed AccessCore's `iss` claim, or offline verification fails
> with 401. A protected call also requires the caller's subject to hold the matching `ledger.*`
> permission in AccessCore on `{type: "ledger", id: "miniledger"}` — the grant in
> [`demo.md`](demo.md). `/metrics` is not routed publicly.

The dashboard ([ADR-013](adr/013-web-dashboard.md)) holds no data and no secrets: it logs in against
AccessCore and proxies ledger calls to the API over the private network, keeping the access token
in an httpOnly cookie.

## Rollback & observability

- **Rollback** — set `MINILEDGER_IMAGE_TAG` to the previous SHA and `docker compose up -d`. Migrations are **additive/forward-only** (append-only
  postings, `REVOKE`, the deferred trigger); there is no destructive down-migration path, so a schema
  rollback would be a deliberate, reviewed forward migration.
- **Health** — `GET /health` (liveness) and `GET /ready` (a `SELECT 1` readiness probe) back
  orchestrator checks; `docker-compose` uses `pg_isready` for the database.
- **Observability** — structured JSON logs (`nestjs-pino`) with a per-request correlation id
  (`x-request-id`, echoed on the response) and a redacted `Authorization` header; Prometheus metrics
  at `GET /metrics`, reachable only from a private network in production (default Node/process metrics plus an `http_request_duration_seconds` histogram —
  the RED signals per route). See [ADR-012](adr/012-observability.md).

## Deferred hardening

- **Distributed tracing** — OpenTelemetry, to adopt alongside a collector and propagate the
  correlation id as the trace id; structured logs and Prometheus metrics ship today
  ([ADR-012](adr/012-observability.md)).
