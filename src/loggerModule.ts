import { RequestMethod } from '@nestjs/common';
import { context, trace } from '@opentelemetry/api';
import { randomUUID } from 'node:crypto';
import { IncomingMessage, ServerResponse } from 'node:http';
import { LoggerModule } from 'nestjs-pino';
import { GenReqId, ReqId } from 'pino-http';

import { pinoHttp } from './configs/log.config.env';

const genReqId: GenReqId = (req: IncomingMessage, res: ServerResponse) => {
  const reqId = req.id as string;
  const xRequestId = req.headers['x-request-id'] as string;
  const randomId = randomUUID();
  const id: string = reqId ?? xRequestId ?? randomId;

  res.setHeader('x-request-id', id);
  return id as ReqId;
};

export const loggerModule = LoggerModule.forRoot({
  pinoHttp: {
    level: pinoHttp.level,
    genReqId,
    transport: pinoHttp.transport,
    redact: {
      paths: ['res.headers', '[*].remoteAddress', '[*].remotePort'],
      remove: true,
    },
    serializers: {
      req(req) {
        return req;
      },
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
    { method: RequestMethod.ALL, path: '/health/*path' },
    { method: RequestMethod.ALL, path: '/metrics' },
    { method: RequestMethod.ALL, path: '/healthz' },
  ],
});
