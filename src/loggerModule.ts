import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { type DynamicModule, RequestMethod } from '@nestjs/common';
import { context, trace } from '@opentelemetry/api';
import { LoggerModule, type Params } from 'nestjs-pino';
import type { GenReqId } from 'pino-http';

import { pinoHttp } from './configs/log.config.env';

const genReqId: GenReqId = (req: IncomingMessage, res: ServerResponse) => {
  const reqId = req.id as string;
  const xRequestId = req.headers['x-request-id'] as string;
  const randomId = randomUUID();
  const id: string = reqId ?? xRequestId ?? randomId;

  res.setHeader('x-request-id', id);
  return id;
};

/**
 * The req serializer below keeps only the request line, but a service can still log a raw request or
 * headers object by hand. A bearer token in a log line is a credential anyone with log access can
 * replay until it expires; the same goes for the session cookie. Strip them here rather than trusting
 * each service to remember.
 *
 * Exported so the property can be tested against real pino output instead of asserted as config.
 */
export const logRedactPaths = [
  'res.headers',
  '[*].remoteAddress',
  '[*].remotePort',
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'req.headers["x-secret-key"]',
  'res.headers["set-cookie"]',
];

/** Exported so the spec can run real pino-http with exactly these options. */
export const loggerParams: Params = {
  pinoHttp: {
    level: pinoHttp.level,
    genReqId,
    transport: pinoHttp.transport,
    // Logs written while handling a request carry only reqId instead of the whole req object.
    quietReqLogger: true,
    redact: {
      paths: logRedactPaths,
      remove: true,
    },
    serializers: {
      // Headers, query and params were most of the bytes on every request line we ship to Grafana.
      req: (req) => ({ id: req.id, method: req.method, url: req.url }),
    },
    formatters: {
      log(object) {
        const span = trace.getSpan(context.active());
        if (!span) return object;
        const { spanId, traceId } = span.spanContext();
        return { ...object, spanId, traceId };
      },
    },
  },

  exclude: [
    { method: RequestMethod.ALL, path: 'health' },
    { method: RequestMethod.ALL, path: 'health/(.*)' },
    { method: RequestMethod.ALL, path: 'metrics' },
    { method: RequestMethod.ALL, path: 'healthz' },
  ],
};

/**
 * forRoot() only creates providers for the @InjectPinoLogger() contexts registered when it is called.
 * Services import this package first thing (otel.ts has to load before express and pg), so calling it
 * here would run before any provider file and every injected logger would fail to resolve. The getters
 * defer it until Nest reads the module at bootstrap, when all decorators have run.
 */
export const loggerModule: DynamicModule = {
  module: LoggerModule,
  get providers() {
    return LoggerModule.forRoot(loggerParams).providers;
  },
  get exports() {
    return LoggerModule.forRoot(loggerParams).exports;
  },
};
