# ADR-009: AccessCore integration — authN, PEP, and local ownership

- **Status:** Proposed (2026-07-14)
- **Date:** 2026-07-14
- Builds on MiniLedger [ADR-001](001-architecture-style.md) (the `access` module); consumes the
  AccessCore SDK (`@diegowritescode/accesscore-sdk`, published per
  [AccessCore ADR-017](https://github.com/diegowritescode/accesscore/blob/main/docs/adr/017-sdk-packaging-and-publishing.md))
  and honors AccessCore's provenance-based authorization contract (subject/org derived server-side
  from the verified token).

## Context

The `access` module is specified in [ADR-001](001-architecture-style.md) but unbuilt: "an **authN
guard** verifying tokens and a **PEP** calling the AccessCore SDK's `check()` before privileged
ledger operations." MiniLedger exists in part to be the SDK's **first real consumer**, so this ADR
is where that integration is designed. Three coupled questions:

1. **Who authenticates the caller?** The SDK ships a PEP (`createClient().check()` + the NestJS
   `AccessCorePermissionGuard` / `@RequirePermission`) but **no authN guard**, and it exposes **no
   caller identity** — the guard yields permit/deny, not "who is this."
2. **Where does account ownership live?** Money operations need a per-resource rule — "you may only
   move money out of an account you own" — which the coarse capability check cannot express.
3. **What is authorized cross-service vs locally**, given AccessCore derives subject/org
   **server-side** from the verified token (a caller cannot assert its identity)?

## Decision

**Hybrid: AccessCore does authN + coarse capability authZ; MiniLedger stores and enforces account
ownership locally.**

- **AuthN — a local `AccessTokenGuard`.** It verifies the AccessCore EdDSA (Ed25519) access token
  **offline** via the AccessCore JWKS (`/.well-known/jwks.json`) using `jose`: signature, `iss`,
  `aud`, `exp`/`nbf` with a 30s clock skew. It attaches `request.principal` (`{subject, org,
sessionId, assuranceLevel}`), exposed via `@CurrentPrincipal()`. Config: `ACCESSCORE_BASE_URL`,
  `ACCESSCORE_JWKS_URL`, `ACCESSCORE_JWT_ISSUER`, `ACCESSCORE_JWT_AUDIENCE`,
  `ACCESSCORE_CLOCK_SKEW_SECONDS`, `ACCESSCORE_CHECK_TIMEOUT_MS`. Failures → RFC 7807 `401`. The
  JWKS resolver sits behind an injectable port so tests use a local key set (no network). This guard
  is the reference implementation for a future SDK authN guard — the gap the first consumer surfaced.
- **AuthZ — the SDK PEP for coarse capability.** The SDK's `AccessCorePermissionGuard`, with the
  client built from the validated `ENV` via a provider factory (the SDK's `forRoot` takes only static
  config — MiniLedger wires the client itself, another gap the first consumer surfaced), and
  `@RequirePermission` on the privileged routes: `POST /accounts` (`ledger.open`), `POST /transfers`
  (`ledger.transfer`), `GET /audit/*` (`ledger.audit`) — all on the resource
  `{type:'ledger', id:'miniledger'}` (actions are `namespace.verb`, namespace == resource type;
  tenant isolation is automatic via the token `org` claim). Reason → status:
  `unauthenticated` → 401, other deny → 403, `pdp_unavailable` → **503 (fail-closed)**. AccessCore
  is seeded via its PAP with a `ledger` namespace granting these to an `operator` relation.
- **Ownership — local.** `accounts.owner_id` (`text`, nullable, indexed, **no FK** — it is an opaque
  external identity; MiniLedger does not own the users table; system accounts like `@world` are
  null). `open` sets `owner_id = subject`; `GET /accounts` is scoped to the owner; `GET /accounts/:id`
  returns **404** when the caller is not the owner (no existence leak); a transfer requires
  `from.owner_id === subject`, else `403`.
- **Reads stay local.** Only mutations and the global audit take the AccessCore dependency; the
  ownership-scoped reads are cheap and remain available when the PDP is down.

## Consequences

### Positive

- **No cross-service write coupling** — opening an account commits in a single local transaction;
  no owner tuples are written to AccessCore, so there is no two-system commit.
- **Correct data ownership** — "who owns account X" is a ledger fact, kept in the ledger.
- **Provenance-safe by construction** — MiniLedger forwards the end-user bearer to `check()` and
  never asserts a subject, honoring AccessCore's contract.
- **Fail-closed money path with no partial commit** — the capability check runs in the guard,
  _before_ the unit of work, so a PDP retry can never leave a half-applied transfer.
- **Demonstrates the SDK end-to-end** and surfaces the authN-guard gap as an upstream candidate.

### Negative / costs

- **Privileged ops depend on AccessCore availability** (mitigated: short timeout, fail-closed 503,
  and local ownership enables a future degraded-read mode).
- **Offline verification honors a revoked-but-unexpired token on local reads** (≤ token TTL, 15 min);
  privileged ops stay safe because the PEP forwards to `/authz/check`, which enforces revocation
  server-side. A deliberate trade for cheap, available reads.
- **The token is verified twice on privileged routes** (local authN + the PEP's forward) —
  defense-in-depth, negligible cost.
- **AccessCore must be seeded** (the `ledger` namespace + operator grants) before checks pass.

## Alternatives considered

- **(A) Full ReBAC — write account-owner tuples to AccessCore's PAP on open** — rejected: it couples
  the ledger write path to AccessCore (a two-system commit — the distributed-transaction smell
  [ADR-001](001-architecture-style.md) rejects) and inverts data ownership. A later ring, not day one.
- **(B) Pure-local auth** — rejected: it discards the reason MiniLedger exists (consuming the SDK)
  and re-implements RBAC it should not own.
- **PEP on reads / a per-account PDP resource (`{type:'account', id}`)** — rejected: per-account
  authorization needs account tuples in AccessCore, i.e. option A.
