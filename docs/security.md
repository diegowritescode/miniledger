# Security

MiniLedger moves money, so its security model is defense-in-depth: authentication and coarse
authorization are delegated to **AccessCore** (the portfolio's IAM flagship), per-resource
ownership is enforced **locally**, and the ledger's history is made **tamper-evident** at the
database. The authorization design is [ADR-009](adr/009-accesscore-integration.md); the
tamper-evidence design is [ADR-008](adr/008-audit-hash-chain.md).

## Authentication

Callers present a bearer **AccessCore access token** (`Authorization: Bearer <jwt>`). The local
`AccessTokenGuard` (`src/access/access-token.guard.ts`) verifies it **offline** with `jose`:

- **Signature** — EdDSA (Ed25519), verified against the AccessCore **JWKS**
  (`/.well-known/jwks.json`, fetched and cached via `createRemoteJWKSet`). No AccessCore round-trip
  is needed to authenticate.
- **Claims** — `iss` must equal `ACCESSCORE_JWT_ISSUER`, `aud` must equal `ACCESSCORE_JWT_AUDIENCE`,
  and `exp`/`nbf` are enforced with a **30 s clock skew** (`ACCESSCORE_CLOCK_SKEW_SECONDS`).
- **Principal** — on success the guard attaches `request.principal =
{ subject, org, sessionId, assuranceLevel }` (from `sub`/`org`/`sid`/`aal`), exposed to handlers
  via the `@CurrentPrincipal()` parameter decorator. A missing/invalid/expired token, or one with no
  `sub`, yields an RFC 7807 **401**.

The JWKS resolver sits behind an injectable port (`JWKS_RESOLVER`) so tests supply a local key set
and never touch the network. This local authN guard is the reference implementation for a future
SDK-provided guard — see [Provenance-safe contract](#provenance-safe-contract) and
[business-context.md](business-context.md).

## Authorization

Authorization is **hybrid** ([ADR-009](adr/009-accesscore-integration.md)): AccessCore answers the
coarse "may this principal operate the ledger at all?", and MiniLedger answers the fine-grained
"does this principal own _this_ account?".

### Capability check — the SDK PEP (cross-service)

Privileged routes are decorated with the SDK's `@RequirePermission(action, resource)`, which wires
the `AccessCorePermissionGuard`. The guard forwards the caller's bearer token to AccessCore's
`check()` on the resource `{ type: 'ledger', id: 'miniledger' }`:

| Route                     | Action            |
| ------------------------- | ----------------- |
| `POST /accounts`          | `ledger.open`     |
| `POST /transfers`         | `ledger.transfer` |
| `POST /reversals`         | `ledger.reverse`  |
| `GET /audit/accounts/:id` | `ledger.audit`    |
| `GET /audit/conservation` | `ledger.audit`    |

The action is `namespace.verb` (namespace == resource type); tenant isolation is automatic via the
token's `org` claim. The SDK maps the decision to HTTP:

- `unauthenticated` → **401**
- any other deny (e.g. `default_deny`, `org_mismatch`) → **403**
- `pdp_unavailable` → **503 — fail-closed** (a money operation is never permitted when the policy
  decision point cannot be reached).

Because the capability check runs in the guard **before** the unit of work, a PDP failure or a deny
can never leave a half-applied transfer.

### Ownership check — local (per-resource, anti-IDOR)

`accounts.owner_id` (`text`, nullable, indexed, **no FK** — it is an opaque external identity;
MiniLedger does not own the users table; system accounts like `@world` are `NULL`) is the object-level
guard:

- **Open** sets `owner_id = principal.subject`.
- **`GET /accounts`** lists only the caller's own accounts plus system accounts (`listVisibleTo`).
- **`GET /accounts/:id`** returns **404** — not 403 — when the caller is neither the owner nor a
  system account, so existence is not leaked (no IDOR).
- **`POST /transfers`** requires the caller to own the **source** account (`from.owner_id ==
subject`), else **403 `not_account_owner`**. The `@world` system account is exempt, so any
  authorized operator can deposit from it.
- **`POST /reversals`** is **capability-gated only** (`ledger.reverse`), not ownership-gated: a
  reversal is a corrective back-office action that posts a compensating entry, so the source-ownership
  check is deliberately skipped (the shared posting core takes `requireOwner: null`). Restricting who
  may reverse is done at the capability layer in AccessCore, not per source account.

### Defense in depth — the double verify

On a privileged route the token is verified **twice**: once locally by `AccessTokenGuard` (offline
JWKS), and again server-side by AccessCore when the PEP forwards it to `/authz/check`. The local
verify gives cheap authN and a principal for ownership; the forwarded verify lets AccessCore enforce
**revocation** (an offline verify honors a revoked-but-unexpired token up to its TTL, ≤ 15 min — a
deliberate trade for cheap local reads, closed on the write path by the server-side check). The
extra verification is negligible cost.

### Provenance-safe contract

MiniLedger **never asserts an identity**. It forwards the end-user bearer to `check()` and reads
`subject`/`org` only from the verified token; AccessCore derives subject/org server-side, so a caller
cannot claim to be someone else. Ownership tuples are **not** written to AccessCore — "who owns
account X" is a ledger fact kept in the ledger — which avoids a two-system commit on the write path
([ADR-009](adr/009-accesscore-integration.md)).

## Data-integrity security (tamper-evidence)

History is protected in three layers ([ADR-005](adr/005-double-entry-model.md),
[ADR-008](adr/008-audit-hash-chain.md)):

1. **Append-only by design** — there are no `UPDATE`/`DELETE` code paths for postings; correction
   is always a new compensating entry.
2. **Append-only by privilege** — the migration issues `REVOKE UPDATE, DELETE ON postings FROM
PUBLIC`, and the application connects as the **least-privilege `miniledger_app` role**
   ([ADR-011](adr/011-least-privilege-db-role.md)) holding only `SELECT`/`INSERT` on `postings` and
   `journal_transactions` — so even a direct SQL statement from the running app cannot mutate recorded
   history. A table's owner bypasses grants, so DDL migrations run as the owner over a separate
   connection while the app never does; an integration test proves the runtime role is refused
   (`42501`) on `UPDATE`/`DELETE`.
3. **Tamper-evident by hash chain** — each posting stores `prev_hash` and
   `hash = sha256(prev_hash ‖ transaction_id ‖ account_id ‖ amount ‖ balance_after)`, advanced under
   the same `FOR UPDATE` balance lock the transfer already holds (one chain **per account**, so
   detection costs no concurrency). The read-only verifier
   (`GET /audit/*`) recomputes each chain and cross-checks reconciliation and conservation, flagging
   exactly where a chain diverges.

**Honest limit:** a hash chain proves **internal consistency, not authorship**. An attacker with
owner-level DB access who rewrites a posting _and_ recomputes the entire tail of that account's chain
(and `account_balances.chain_hash`) would pass verification. Cryptographic **signing** (a KMS/Vault
key) would close that gap and is a documented later ring; it was deferred to avoid key management this
scale does not yet need ([ADR-008](adr/008-audit-hash-chain.md)).

## Errors

Every error is **RFC 7807** `application/problem+json` (`type`/`title`/`status`/`detail`), rendered
by a global `ProblemDetailsFilter`. Error responses never include stack traces or secrets.

## Secrets & config

- All configuration is environment-driven, parsed and validated by a zod schema at boot
  (`src/config/env.ts`); an invalid environment fails fast. `.env.example` documents every variable;
  the real `.env` is git-ignored. **No secrets are committed.**
- The AccessCore variables are non-secret endpoints/claims: `ACCESSCORE_BASE_URL`,
  `ACCESSCORE_JWKS_URL`, `ACCESSCORE_JWT_ISSUER`, `ACCESSCORE_JWT_AUDIENCE`,
  `ACCESSCORE_CLOCK_SKEW_SECONDS`, `ACCESSCORE_CHECK_TIMEOUT_MS`. Trust is anchored in AccessCore's
  **public** JWKS, so MiniLedger holds no signing key — there is no token secret to leak.
- `helmet` sets baseline security headers; the JSON body is capped at 32 kB.

## Rate limiting

A global `ThrottlerGuard` caps requests per client to `THROTTLE_LIMIT` per `THROTTLE_TTL_SECONDS`
(default 100 / 60 s); over the cap returns **429** as RFC 7807. Liveness/readiness (`/health`,
`/ready`) and metrics scraping (`/metrics`) are exempt (`@SkipThrottle`) so probes and Prometheus are
never throttled. The counter is **in-memory**, which is correct for the single-instance deployment;
running multiple replicas would need a shared store (Redis) so the limit is enforced across them.

## Threats considered (OWASP)

| Threat                              | Mitigation                                                                                                              |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| **Broken object-level auth (IDOR)** | Local `owner_id` scoping; `GET /accounts/:id` returns 404 (not 403) for non-owners; transfers require source ownership. |
| **Broken authentication**           | EdDSA JWT verified offline against AccessCore JWKS; `iss`/`aud`/`exp`/`nbf` enforced with bounded skew.                 |
| **Broken function-level auth**      | SDK capability PEP on every privileged route; **fail-closed 503** when the PDP is unreachable.                          |
| **Injection**                       | Parameterized Drizzle queries; zod-validated DTOs; `bigint` amounts, never string-concatenated SQL.                     |
| **Tampering with the ledger**       | Append-only postings, `REVOKE UPDATE, DELETE`, and a per-account hash chain the verifier checks.                        |
| **Sensitive data exposure**         | No secrets in git; public-JWKS trust anchor; RFC 7807 errors carry no internals; security headers via helmet.           |
| **Replay / double-spend**           | Idempotency keys claimed inside the transfer transaction ([ADR-007](adr/007-idempotency.md)).                           |
| **Token revocation on writes**      | PEP forwards the token to AccessCore, which enforces revocation server-side on privileged operations.                   |

## Seeding AccessCore (operator runbook)

Capability checks only pass once AccessCore is seeded with the `ledger` namespace and the operator
grants. These are the steps an operator runs **against AccessCore's PAP** (the exact CLI/API surface
is AccessCore's — see its docs; the shape below mirrors its ReBAC namespace/relation model):

```text
# 1. Define the `ledger` namespace: a relation `operator` that carries the three ledger capabilities.
#    (namespace == the PDP resource type used by @RequirePermission → {type:'ledger', id:'miniledger'})
namespace ledger {
  relation operator
  permission ledger.open     = operator
  permission ledger.transfer = operator
  permission ledger.reverse  = operator
  permission ledger.audit    = operator
}

# 2. Grant a principal the operator relation on the miniledger resource, scoped to their org.
#    Any bearer whose token `sub` == <subject> can then open accounts, transfer, reverse, and audit.
grant  ledger:miniledger#operator@user:<subject>
```

After seeding, a token for `<subject>` (in the matching `org`) passes `check()` for
`ledger.open`/`ledger.transfer`/`ledger.reverse`/`ledger.audit`; anyone else is denied **403**. Because the SDK's PEP
resolves the resource as `{type:'ledger', id:'miniledger'}` and the check is org-scoped via the
token's `org` claim, tenant isolation is automatic — no per-account tuples are written to AccessCore
([ADR-009](adr/009-accesscore-integration.md) rejects that as a two-system commit).
