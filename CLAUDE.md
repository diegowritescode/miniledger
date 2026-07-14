# MiniLedger — Claude guide

A project in a senior backend portfolio (its own git repo), built to a fixed quality bar.

## Communication
- Respond to the user in **Spanish**. All public artifacts (code, docs, README, ADRs, commits) in **English**.

## Stack (fixed)
Node.js · NestJS · TypeScript · PostgreSQL · Redis · RabbitMQ. Any deviation requires an ADR in `docs/adr/`.

## Quality bar (non-negotiable)
- Unit + integration tests (E2E where there's a flow); ~80%+ coverage on core logic — quote the real number in the README.
- GitHub Actions: lint → test → build on every push.
- `docker compose up` boots the full stack from a clean clone; `.env.example` documents every var; no secrets in git.
- Deployed with a public URL in the README; screenshots/demo included.
- Full `docs/` (business-context, architecture, data-model, api, security, testing-strategy, deployment, trade-offs) + real ADRs. **Documentation is the key differentiator — never skip it.**

## Structure
Standard layout: `src/ tests/ scripts/ postman/ diagrams/ docs/{...,adr/}`. Follow the existing files; don't reinvent.

## Tooling in this repo
- `/adr <title>` — record a decision.
- `/quality-audit` — check this project against the bar before calling it done.
- Subagents: `backend-architect`, `test-engineer`, `security-auditor`, `tech-writer`.

## Guardrails
- Modular monolith by default; justify any distribution in an ADR.
- Commit/push only when asked. Never commit secrets.
