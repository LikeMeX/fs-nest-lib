import { Writable } from 'node:stream';
import { Injectable } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import pino from 'pino';

import { loggerModule, logRedactPaths } from './loggerModule';

/**
 * Services import this package from otel.ts before anything else, so loggerModule is evaluated before
 * any provider file runs its @InjectPinoLogger(). This class is decorated after the import above,
 * which is the same order.
 */
@Injectable()
class LateDecoratedService {
  constructor(@InjectPinoLogger('LateDecoratedService') readonly logger: PinoLogger) {}
}

describe('loggerModule', () => {
  it('resolves @InjectPinoLogger() loggers declared after the package was imported', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [loggerModule],
      providers: [LateDecoratedService],
    }).compile();

    expect(moduleRef.get(LateDecoratedService).logger).toBeInstanceOf(PinoLogger);
    await moduleRef.close();
  });
});

/**
 * The module logs the request object whole, headers included. These assertions run a real pino
 * instance with the shared redaction and read what actually lands in the sink, so they fail if the
 * paths stop matching pino's syntax — which asserting the config array would not catch.
 */
describe('log redaction', () => {
  const logOnce = (record: unknown): string => {
    let out = '';
    const sink = new Writable({
      write(chunk, _enc, cb) {
        out += chunk.toString();
        cb();
      },
    });
    pino({ redact: { paths: logRedactPaths, remove: true } }, sink).info(record as object);
    return out;
  };

  const request = {
    req: {
      method: 'POST',
      url: '/api/order/1052/transfer-payments',
      headers: {
        host: 'dev-pay-api.futureskill.live',
        authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.PAYLOAD.SIGNATURE',
        cookie: 'session=super-secret',
        'x-api-key': 'ak_live_should_not_appear',
        'content-type': 'application/json',
      },
    },
  };

  it('keeps no bearer token in the output', () => {
    const out = logOnce(request);
    expect(out).not.toContain('Bearer');
    expect(out).not.toContain('SIGNATURE');
    expect(out).not.toContain('authorization');
  });

  it('keeps no cookie or api key in the output', () => {
    const out = logOnce(request);
    expect(out).not.toContain('super-secret');
    expect(out).not.toContain('ak_live_should_not_appear');
  });

  it('still logs the parts that make a request identifiable', () => {
    const out = logOnce(request);
    expect(out).toContain('/api/order/1052/transfer-payments');
    expect(out).toContain('POST');
    expect(out).toContain('dev-pay-api.futureskill.live');
  });

  it('strips set-cookie from responses', () => {
    const out = logOnce({ res: { statusCode: 200, headers: { 'set-cookie': 'session=leaked' } } });
    expect(out).not.toContain('leaked');
  });
});
