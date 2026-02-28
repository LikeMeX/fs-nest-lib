# fs-nest-lib

NestJS library providing OpenTelemetry (OTLP) tracing and Pino-based request logging with trace/span correlation.

## Requirements

- **Node.js** ≥ 24  
- **pnpm** (recommended) or npm/yarn

## Installation

```bash
pnpm add fs-nest-lib
# or
npm install fs-nest-lib
```

## Usage

### 1. OTLP tracing

Initialize the OpenTelemetry SDK **before** creating your Nest app (e.g. at the top of `main.ts` or in a bootstrap file):

```ts
import otlpSdk from 'fs-nest-lib';

otlpSdk({
  exporterUrl: process.env.OTLP_EXPORTER_URL ?? 'http://localhost:4317',
  ignoreIncomingRequestUrls: ['/custom-skip'], // optional; health/metrics are ignored by default
}).start();

// Then bootstrap Nest
const app = await NestFactory.create(AppModule);
// ...
```

Use the shared tracer for custom spans:

```ts
import { tracer } from 'fs-nest-lib';

const span = tracer.startSpan('my-operation');
// ... do work ...
span.end();
```

**Default ignored paths** (no spans): `/health`, `/healthz`, `/metrics`, `/health/readiness`, `/health/liveness`.

**Auto-instrumentation**: HTTP, NestJS core, and KafkaJS are enabled; FS instrumentation is disabled.

### 2. Logger module (Pino)

Import the preconfigured logger module in your app:

```ts
import { Module } from '@nestjs/common';
import { loggerModule } from 'fs-nest-lib';

@Module({
  imports: [loggerModule],
  // ...
})
export class AppModule {}
```

- **Request ID**: Uses `req.id`, `x-request-id` header, or a generated UUID; sets `x-request-id` on the response.
- **Trace correlation**: Logs include `spanId` and `traceId` when a span is active.
- **Redaction**: `res.headers`, `[*].remoteAddress`, and `[*].remotePort` are redacted.
- **Excluded routes**: `/health/*`, `/metrics`, `/healthz` are not logged.

Inject the logger in services/controllers:

```ts
import { PinoLogger } from 'nestjs-pino';

@Injectable()
export class MyService {
  constructor(private readonly logger: PinoLogger) {}
  doSomething() {
    this.logger.info('message');
  }
}
```

## Environment variables

### OTLP

| Variable             | Description                          |
|----------------------|--------------------------------------|
| `OTLP_EXPORTER_URL`  | gRPC endpoint for trace export       |
| `SERVICE_NAME`       | Service name in traces               |
| `VERSION`            | Service version                      |
| `NODE_NAME`          | K8s node name (optional)             |
| `POD_NAME`           | K8s pod name (optional)              |
| `POD_NAMESPACE`      | K8s namespace (optional)             |

### Logging

| Variable                 | Description                                  |
|--------------------------|----------------------------------------------|
| `LOG_LEVEL`              | Pino level: `trace`, `debug`, `info`, `warn`, `error`, `fatal` (default: `info`) |
| `IS_PINO_PRETTY`         | `true` for pretty-printed logs (e.g. local dev) |
| `IS_LOG_GLOBAL_PAYLOAD`  | Global payload flag (optional)               |

## Exports

- **`otlpSdk(options)`** – Creates and returns the OpenTelemetry `NodeSDK`; call `.start()` before bootstrapping Nest.
- **`tracer`** – Shared tracer for the configured service name.
- **`loggerModule`** – NestJS dynamic module for `nestjs-pino` (use in `imports`).

## License

UNLICENSED
