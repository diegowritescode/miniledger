# Security Policy

MiniLedger moves money — it must never lose or invent value, and every change must be provable and
auditable. We take vulnerabilities seriously and appreciate responsible disclosure.

## Reporting a vulnerability

Please **do not** open a public issue for security reports. Instead, use GitHub's private
vulnerability reporting ("Report a vulnerability" under the Security tab) or contact the maintainer
directly.

Include, where possible: affected component, a description, reproduction steps or a
proof-of-concept, and impact. We aim to acknowledge reports within 72 hours.

## Supported versions

This project is pre-1.0 and under active development; only the latest `main` is supported.

## Scope & design

The threat model and controls are documented in [`docs/security.md`](docs/security.md) and the ADRs
under [`docs/adr/`](docs/adr/) — notably the double-entry invariant enforced twice
([ADR-005](docs/adr/005-double-entry-model.md)), concurrency-safe balances
([ADR-006](docs/adr/006-concurrency-safe-balances.md)), the tamper-evident per-account hash chain
([ADR-008](docs/adr/008-audit-hash-chain.md)), the AccessCore-delegated auth model
([ADR-009](docs/adr/009-accesscore-integration.md)), and the least-privilege runtime database role
([ADR-011](docs/adr/011-least-privilege-db-role.md)). Authentication and authorization are delegated
to **AccessCore**; token-verification or PDP findings that cross that boundary should be reported
there as well. Findings that contradict these documents are especially welcome.
