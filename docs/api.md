---
title: fs-nest-lib public exports
repo: fs-nest-lib
layer: backend
tech: NestJS library
default_branch: main
updated: 2026-04-24
source_path: docs/api.md
---

# Public exports — fs-nest-lib

No HTTP API. Library-level exports from `src/index.ts`:

## Logger

```ts
import { LoggerModule, FSLogger } from 'fs-nest-lib';

@Module({ imports: [LoggerModule.forRoot({ serviceName: 'fs-credential-api' })] })
export class AppModule {}
```

## OpenTelemetry

```ts
import { initOtel } from 'fs-nest-lib/otlp';

initOtel({ serviceName: 'fs-credential-api', endpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT });
```

Call `initOtel` before Nest bootstrap.

## Configs

```ts
import { loadConfig } from 'fs-nest-lib/configs';

const config = loadConfig();
```

Standardizes `DATABASE_URL`, `REDIS_URL`, `RABBITMQ_URL`, `JWT_SECRET` parsing.

## Semantic conventions

```ts
import { SemConv } from 'fs-nest-lib/semconv';
span.setAttribute(SemConv.SERVICE_NAME, 'fs-credential-api');
```

Canonical attribute keys so dashboards stay consistent.

## Publishing

Package published to internal registry (or GitHub Packages). Consumer repos pin a specific version in `package.json`.
