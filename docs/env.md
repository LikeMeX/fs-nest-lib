---
title: fs-nest-lib env vars
repo: fs-nest-lib
layer: backend
tech: NestJS library
default_branch: main
updated: 2026-04-24
source_path: docs/env.md
---

# Env vars — fs-nest-lib

No runtime env vars of its own. Consumer services inject via `loadConfig()`:

| Var | Consumed by | Purpose |
|---|---|---|
| `SERVICE_NAME` | logger, otlp | Tag logs + traces |
| `LOG_LEVEL` | logger | `debug`, `info`, `warn`, `error` |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | otlp | Trace exporter URL |
| `OTEL_SERVICE_NAME` | otlp | Overrides `SERVICE_NAME` for OTel |
| `NODE_ENV` | configs | Runtime mode |

## Publish-time env

| Var | Purpose |
|---|---|
| `NPM_TOKEN` | Publish to registry (CI only) |
| `GITHUB_TOKEN` | semantic-release commit back |
