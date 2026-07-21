# ADR-013: Web dashboard (Next.js BFF)

- **Status:** Accepted (2026-07-20)
- **Date:** 2026-07-20
- How MiniLedger gets a human-facing UI without weakening its auth model or its single-package API.

## Context

MiniLedger is an API: a recruiter or operator can only reach it through `curl` or the Swagger page
at `/docs`. Its distinctive properties — balances moving under double-entry, idempotent retries, and
a per-account audit hash chain that _proves_ money is conserved — are invisible without a UI. The
sibling project (AccessCore) already ships a Next.js console; MiniLedger should reach visual parity
and make its guarantees demonstrable.

Two constraints shape the design:

- **The API is a single-package repo** (ADR-002). We do not want to turn it into a workspace or
  couple a frontend build into the API's build.
- **MiniLedger does not issue tokens.** It only _verifies_ AccessCore's EdDSA JWTs offline (ADR-009).
  A browser must never hold a raw access token, and the dashboard must not invent its own auth.

## Decision

Add a **separate, self-contained Next.js app under `web/`** — its own `package.json`, its own
build, its own deployable — a sibling of the root API, not a workspace member. The API stays a
single package; `web/` is ignored by the API's tooling (root ESLint `ignores: ['web/**']`) and has
its own lint/typecheck/build job in CI.

The dashboard is a **backend-for-frontend (BFF)**, mirroring the AccessCore console:

- The browser never sees a token. Login posts credentials to a Next route handler, which calls
  **AccessCore** `/auth/login`, and stores the returned access token in an **httpOnly, SameSite=Lax**
  cookie (`ml_token`). Every data call goes to a same-origin `/api/*` route that reads the cookie and
  proxies to the **MiniLedger** API with the bearer token attached server-side.
- So there are two upstreams: **AccessCore** for authentication (login/logout) and **MiniLedger**
  for ledger data — configured by `ACCESSCORE_API_URL` and `MINILEDGER_API_URL`.
- The design system (light theme, `@theme` tokens, UI kit, EN/ES i18n) is carried over from the
  AccessCore console for consistency and speed.

## Consequences

- The ledger's guarantees become demonstrable in a browser: open accounts, move money with an
  idempotency key, read a statement, and verify the audit chain + conservation — the same flow the
  `demo.sh` script proves over HTTP.
- The token stays server-side; XSS in the dashboard cannot exfiltrate it, and the MiniLedger API's
  offline-verification model is unchanged (the dashboard is just another bearer-token client).
- Two deployables in one repo. `web/` builds to a standalone Next output and deploys independently
  (its own Dokploy app / subdomain), pointing its `ACCESSCORE_*`/`MINILEDGER_*` at the live services.
- Reusing the AccessCore console's patterns is deliberate coupling-by-copy, not a shared package —
  consistent with the portfolio's "carry patterns forward, documented" strategy.
