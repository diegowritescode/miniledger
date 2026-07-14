---
name: quality-audit
description: Audit a portfolio project against the CONVENTIONS.md quality bar and produce a pass/fail gap report with concrete fixes. Use before calling a project "done" or before showing it to recruiters.
argument-hint: <project-slug or path>
allowed-tools: Bash, Read, Grep, Glob
---

Audit the project at `$ARGUMENTS` (default: current directory) against the quality bar in CONVENTIONS.md §4–5. **Report only — do NOT fix anything.**

Mark each item ✅ / ❌ / ⚠️ with evidence (file paths, line refs, real numbers). A template stub that was never filled counts as ❌.

**Structure & docs**
- README follows the template and has all sections: overview, business problem, architecture, data model, security, testing strategy, deployment (with live URL), trade-offs, screenshots/demo, how-to-run.
- `docs/` present and actually filled: business-context, architecture, data-model, api, security, testing-strategy, deployment, trade-offs.
- At least one real ADR beyond `000-template.md`.

**Quality**
- Unit + integration tests exist; E2E where there's a real flow.
- Coverage is measured — report the actual %.
- GitHub Actions workflow present and runs lint → test → build.
- `docker-compose.yml` boots the stack; `.env.example` documents every var; no secrets committed.
- Deployed with a reachable public URL in the README.

**Signal**
- Code matches the fixed stack; any deviation justified by an ADR.
- No over-engineering; no obvious dead code.

Output: a compact report grouped by the sections above, then a prioritized **"Top fixes before this is recruiter-ready"** list. Be specific and honest.
