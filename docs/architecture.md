---
title: fs-nest-lib architecture
repo: fs-nest-lib
layer: backend
tech: NestJS library
default_branch: main
updated: 2026-04-24
source_path: docs/architecture.md
---

# Architecture — fs-nest-lib

Shared NestJS utilities consumed by every FutureSkill NestJS service.

Platform map: [FutureSkill architecture overview](https://github.com/LikeMeX/fs-infrastructure/blob/main/docs/architecture.md).

## Exports

Re-exported from `src/index.ts`:

- **Logger module** (`loggerModule.ts`) — unified Winston/Pino logger bootstrap.
- **OpenTelemetry** (`otlp.ts`) — OTLP exporter wiring + trace propagation.
- **Semantic conventions** (`semconv.ts`) — OTel semantic attribute helpers.
- **Configs** (`configs/`) — standardized config schema + env loader.

## Consumers

| Repo | Uses |
|---|---|
| [fs-credential-api](https://github.com/LikeMeX/fs-credential-api) | logger, otlp |
| [fs-content-api](https://github.com/LikeMeX/fs-content-api) | logger, otlp |
| [fs-learn-api](https://github.com/LikeMeX/fs-learn-api) | logger, otlp |
| [fs-assessment](https://github.com/LikeMeX/fs-assessment) | logger, otlp |
| [fs-payment-api](https://github.com/LikeMeX/fs-payment-api) | logger, otlp |

## Runtime contract

- Log format: JSON with `traceId`, `spanId`, `service.name`.
- OTLP exporter pushes to [fs-infrastructure](https://github.com/LikeMeX/fs-infrastructure) Jaeger collector.
