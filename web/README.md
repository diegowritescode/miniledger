# MiniLedger Dashboard

A web dashboard for [MiniLedger](../README.md) — accounts and balances, transfers with an
idempotency key, account statements, and an integrity panel that verifies the audit hash chain and
conservation of money. Built with Next.js (App Router) as a **backend-for-frontend**.

## How it works

The browser never holds a token. This app authenticates against **AccessCore** and proxies ledger
calls to **MiniLedger** server-side:

- **Login** posts credentials to a Next route handler, which calls AccessCore `/auth/login` and
  stores the access token in an **httpOnly, SameSite=Lax** cookie (`ml_token`).
- Every data call goes to a same-origin `/api/*` route that reads the cookie and forwards the bearer
  token to the MiniLedger API — so XSS cannot exfiltrate the token, and MiniLedger's offline token
  verification is unchanged (the dashboard is just another bearer client).

Two upstreams, configured by environment: `ACCESSCORE_API_URL` (auth) and `MINILEDGER_API_URL`
(data). Design and rationale in [ADR-013](../docs/adr/013-web-dashboard.md).

## Develop

```bash
cd web
npm ci
cp .env.example .env.local     # point at a running AccessCore + MiniLedger
npm run dev                    # http://localhost:3002
```

| Variable             | Default                      | Purpose                    |
| -------------------- | ---------------------------- | -------------------------- |
| `ACCESSCORE_API_URL` | `https://auth.deviego.xyz`   | Login/logout proxy target. |
| `MINILEDGER_API_URL` | `https://ledger.deviego.xyz` | Ledger data proxy target.  |

Sign in with an AccessCore account that holds the `ledger` operator capability on
`{type: "ledger", id: "miniledger"}` (the same grant the API demo uses).

## Scripts

```bash
npm run lint        # next lint
npm run typecheck   # tsc --noEmit
npm run build       # next build (standalone output)
```

## Deploy

A multi-stage `Dockerfile` builds the Next.js standalone server. On Dokploy, point the Dockerfile
path at `web/Dockerfile` with the build context at the repository root, map the domain to port
`3002`, and set the two `*_API_URL` variables. Full runbook in
[`docs/deployment.md`](../docs/deployment.md#dashboard-web).

Stack: Next.js 15 · React 19 · TypeScript · Tailwind CSS v4. Light theme, EN/ES.
