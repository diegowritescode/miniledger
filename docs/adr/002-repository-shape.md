# ADR-002: Repository shape — single-package repo, not a workspace

- **Status:** Accepted (2026-07-13)
- **Date:** 2026-07-13
- A deliberate **divergence** from AccessCore
  [ADR-001](https://github.com/diegowritescode/accesscore/blob/main/docs/adr/001-architecture-style.md)'s tooling; the same quality
  bar, a simpler mechanism.

## Context

AccessCore is a **pnpm + Turborepo + changesets workspace**: it ships more than one build unit
(the API app and a published TypeScript **SDK/PEP** consumed by other services), so it needs
workspace-scoped dependency graphs, task orchestration/caching across packages, and independent
versioned releases.

MiniLedger has none of those forces. It is a **single deployable NestJS process** with **no
shared internal packages** and **no second app to build or publish**. The one external contract
it consumes — the AccessCore SDK — arrives as a normal npm dependency, not as a workspace
sibling. The question is therefore not "how do we orchestrate many packages" but "what is the
lightest repository shape that still enforces the portfolio quality bar?"

Reusing AccessCore's workspace here would be **cargo-culting**: importing pnpm/turbo/changesets
config for a repo that has exactly one package to lint, test, build, and deploy. The overhead
(a `pnpm-workspace.yaml`, `turbo.json` pipelines, changeset ceremony, a second lockfile format)
would buy zero payoff and add moving parts a reviewer must read past to find the actual code.

## Decision

Ship MiniLedger as a **single-package repository**: one `package.json` at the root, one
lockfile, one `tsconfig`, one build. **No** pnpm workspace, **no** Turborepo, **no** changesets.

The **high-signal quality gates are kept at the repo root**, unchanged in spirit from
AccessCore — they are what the divergence must not weaken:

- **ESLint + Prettier** — lint and format enforced in CI and pre-commit.
- **commitlint + Husky** — Conventional Commits and pre-commit/pre-push hooks.
- **A merged coverage gate** — unit and integration runs each emit coverage, `nyc` merges the
  reports, and CI fails below the threshold. Coverage is measured across the whole run, not
  per-suite, so integration-only paths cannot dodge the number.
- **GitHub Actions** — `lint → test → build` on every push, plus `docker compose up` booting the
  full stack from a clean clone.

Documented reuse over shared code: MiniLedger carries AccessCore's *patterns* (hexagonal layout,
UoW, ADR discipline) forward by convention, not by importing a shared package — consistent with
the portfolio's independent-repo strategy.

## Consequences

### Positive

- **Lower cognitive and toolchain overhead** — a reviewer clones, `npm ci`, and runs one build;
  nothing to learn about workspace wiring before reading the ledger code.
- **The quality bar is fully preserved** — the gates that actually signal seniority (typed
  strictness, merged coverage, conventional commits, green CI, one-command boot) all remain.
- **Right-sized judgment on display** — deliberately *not* reaching for the heavier tool is
  itself the senior signal; the divergence is documented rather than silent.

### Negative / costs

- **Intentional inconsistency across the spine** — two repos, two repository shapes. Mitigated by
  this ADR making the reason explicit; the shapes are chosen per project, not by drift.
- **No turbo task cache** — full lint/test/build every CI run. Negligible for a single package;
  the cache only pays off across many packages, which do not exist here.
- **If a second build unit ever appears** (e.g. a client SDK for MiniLedger), the workspace
  decision must be revisited — this ADR would then be superseded, not stretched.

## Alternatives considered

- **Mirror AccessCore's pnpm + Turbo + changesets workspace** — rejected: pure overhead with no
  payoff for one package/one app; it would be adopting a solution to a coordination problem this
  repo does not have.
- **A monorepo containing all spine projects** — rejected: it contradicts the portfolio strategy
  of **independent, self-contained repos** (own README/CI/deploy per project) and would couple
  release and CI concerns across otherwise unrelated systems.
- **Nx (single-repo, plugin-driven)** — rejected: even in single-project mode it adds a
  generator/executor layer and config surface that a plain NestJS + npm setup does not need; more
  to justify than to gain.
