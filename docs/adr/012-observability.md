# ADR-012: Observability — structured logs and Prometheus metrics

- **Status:** Accepted (2026-07-16)
- **Date:** 2026-07-16
- What MiniLedger emits so a running instance can be understood and operated.

## Context

Until now the service logged a single line at boot with Nest's default logger, and exposed no
metrics. For a money API that is not enough: an operator needs to correlate the log lines of one
request, must never see a bearer token in a log, and needs request-rate / error-rate / latency
signals to run the thing and alert on it.

The constraint is proportion. Distributed tracing (OpenTelemetry) is only useful with a collector and
a backend to send spans to; MiniLedger has neither deployed, so wiring it now would be ceremony, not
observability.

## Decision

Two pillars, both first-class:

- **Structured logging** with `nestjs-pino` (pino). Every log line is JSON at a configurable
  `LOG_LEVEL`. Each HTTP request gets a **correlation id** (`genReqId`): the inbound `x-request-id` if
  present, otherwise a generated UUID, echoed back on the response header so a client and the server
  share one id. The `authorization` and `cookie` request headers are **redacted** (`[redacted]`) so a
  token can never land in a log. Health and metrics probes are excluded from request logging to keep
  the signal clean. Nest's own logs are routed through pino via `app.useLogger`.
- **Prometheus metrics** with `prom-client`, exposed at **`GET /metrics`** (unauthenticated, like the
  health probes — it is scraped in-network). It carries the default Node/process metrics
  (`collectDefaultMetrics`: CPU, memory, event-loop lag, GC) plus an
  `http_request_duration_seconds` **histogram** labelled by `method`, `route`
  (`Controller.handler`, so cardinality stays bounded — no UUIDs in labels), and `status_code`. That
  one histogram yields Rate, Errors, and Duration (the RED signals) per route. Recording hangs off the
  response `finish` event, so the status code and duration are the final ones.

**Deferred, deliberately:** distributed tracing (OpenTelemetry) — adopt it together with a collector
(e.g. Tempo/Jaeger) and propagate the same correlation id as the trace id. Business-specific counters
(e.g. transfers by result) are a trivial extension of `MetricsService` when a dashboard needs them.

## Consequences

- One request's logs are correlatable end to end, and tokens are structurally impossible to leak into
  logs.
- `/metrics` is Prometheus-scrapeable out of the box; the histogram powers latency SLOs and
  error-rate alerts without any code change.
- `/metrics` is public — acceptable because it exposes only aggregate operational data and is intended
  for in-network scraping; a network policy or basic-auth in front of it is the production-grade next
  step if it is ever exposed publicly.
- The interceptor does not observe requests rejected by a guard before the interceptor runs (e.g. a
  `401` from the auth guard); those are visible in logs. Full edge coverage would move recording to
  middleware — a known, documented trade for the simpler interceptor.
