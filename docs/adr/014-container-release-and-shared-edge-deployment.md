# ADR-014: Immutable container releases behind a shared edge proxy

- **Status:** Accepted (2026-09-23)
- **Date:** 2026-09-23
- Replace the Dokploy build-on-server deployment with images built once in CI, published to GHCR
  under the commit SHA, and run by a versioned Compose file behind a Traefik instance shared with
  other stacks on the same host. Mirrors AccessCore's
  [ADR-027](https://github.com/diegowritescode/accesscore/blob/main/docs/adr/027-container-release-and-shared-edge-deployment.md).

## Context

The API and dashboard ran on a Dokploy VPS that rebuilt each image from source on push. When that
host was retired, the deployment could not be recreated from the repository: services, domains,
and environment lived in Dokploy's database, and the running image was a second build of the
commit rather than the artifact CI had verified. Building a NestJS API and a Next.js app on a small
VPS also competes with the traffic it serves.

The new host already runs an unrelated production stack fronted by Traefik v3 (Let's Encrypt
HTTP-01). Only that Traefik may bind ports 80/443, and this stack must not reach the other stack's
services or datastores.

## Decision

1. **Build once, in CI.** A `Release` workflow runs after `CI` succeeds on `main` and pushes the
   API (`Dockerfile`) and dashboard (`web/Dockerfile`) images to GHCR tagged with the full commit
   SHA, with OCI `source` and `revision` labels.
2. **Deploy by tag.** [`deploy/compose.yml`](../../deploy/compose.yml) is the production topology:
   Postgres, API, dashboard. The host keeps only `deploy/.env` (secrets + `MINILEDGER_IMAGE_TAG`).
   Release and rollback are the same `pull` + `up -d` with a different SHA.
3. **Shared edge, private data.** Only `api` and `web` join the external `edge` network the shared
   Traefik uses; Postgres stays on the stack's private network. No host ports are published; every
   container has a memory limit and log rotation.
4. **AccessCore over its public contract.** The API reaches AccessCore at its public URL, exactly as
   any other consumer of the SDK would ([ADR-009](009-accesscore-integration.md)). The two stacks
   share no network.
5. **`/metrics` is not routed publicly**, and the dashboard reaches the API over the private network.
6. **Least privilege from first boot.** A Postgres init script creates `miniledger_app`
   ([ADR-011](011-least-privilege-db-role.md)) on a fresh volume.

## Consequences

- A clean host deploys from the repository alone; the runbook is
  [`docs/deployment.md`](../deployment.md#production--compose-behind-traefik).
- Production runs the exact image CI built.
- Deploys stay manual over SSH; continuous deployment would put an inbound credential for the host
  in GitHub, which a single host does not justify.
- GHCR packages are made public once so the host can pull without a token.

## Alternatives considered

- **Dokploy on the new host** — a second proxy competing for 80/443 and a topology outside git.
- **Joining the other stack's network** — no isolation from unrelated services.
- **Building on the host** — build drift and CPU contention with production.
