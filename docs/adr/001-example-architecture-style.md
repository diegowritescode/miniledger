# ADR-001: Architecture style — modular monolith

- **Status:** Accepted (example — replace per project)
- **Date:** YYYY-MM-DD

## Context
A single developer needs to ship a maintainable system fast while demonstrating clear
module boundaries. Microservices would add operational overhead (network, deploy,
distributed debugging) with no real scaling need at this stage.

## Decision
Build a **modular monolith**: one deployable, strong internal module boundaries (each
module owns its data and exposes an explicit interface), so it could be split later if
ever justified.

## Consequences
### Positive
- Fast to build, test and deploy; simple local setup.
- Clear boundaries show architectural judgment without premature distribution.
### Negative / costs
- Requires discipline to keep modules from leaking into each other.

## Alternatives considered
- **Microservices** — rejected: operational cost unjustified for the scale and scope.
- **Layered-only (no modules)** — rejected: boundaries by technical layer, not by
  domain, tend to erode.
