import { type ExecutionContext, UnauthorizedException } from '@nestjs/common';
import axios from 'axios';
import { InternalGuard } from './internal.guard';
import { InternalClient } from './internal-client';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMockContext(headers: Record<string, string | undefined>): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ headers }),
    }),
  } as unknown as ExecutionContext;
}

// ---------------------------------------------------------------------------
// InternalGuard
// ---------------------------------------------------------------------------

describe('InternalGuard', () => {
  let guard: InternalGuard;
  const originalToken = process.env['INTERNAL_TOKEN'];

  beforeEach(() => {
    guard = new InternalGuard();
  });

  afterEach(() => {
    // Restore env after each test
    if (originalToken === undefined) {
      delete process.env['INTERNAL_TOKEN'];
    } else {
      process.env['INTERNAL_TOKEN'] = originalToken;
    }
  });

  it('allows a request with correct x-internal-token', () => {
    process.env['INTERNAL_TOKEN'] = 'secret';
    const ctx = makeMockContext({ 'x-internal-token': 'secret' });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('rejects a request with missing x-internal-token header', () => {
    process.env['INTERNAL_TOKEN'] = 'secret';
    const ctx = makeMockContext({});
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('rejects a request with wrong x-internal-token header', () => {
    process.env['INTERNAL_TOKEN'] = 'secret';
    const ctx = makeMockContext({ 'x-internal-token': 'wrong-value' });
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('rejects when INTERNAL_TOKEN env var is not set', () => {
    delete process.env['INTERNAL_TOKEN'];
    const ctx = makeMockContext({ 'x-internal-token': 'anything' });
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });
});

// ---------------------------------------------------------------------------
// InternalClient
// ---------------------------------------------------------------------------

describe('InternalClient', () => {
  const BASE_URL = 'http://content-service:3000';
  const TOKEN = 'secret';

  let client: InternalClient;
  let postSpy: jest.SpyInstance;

  beforeEach(() => {
    client = new InternalClient(BASE_URL, TOKEN);
    postSpy = jest.spyOn(axios, 'post');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('POSTs to /internal/rpc with correct body and token header', async () => {
    postSpy.mockResolvedValueOnce({ data: { id: 42, title: 'NestJS' } });

    await client.send<{ id: number; title: string }>({ cmd: 'GET_COURSE' }, { id: 1 });

    expect(postSpy).toHaveBeenCalledWith(
      `${BASE_URL}/internal/rpc`,
      { cmd: 'GET_COURSE', payload: { id: 1 } },
      { headers: { 'x-internal-token': TOKEN } },
    );
  });

  it('returns res.data unwrapped from the axios response', async () => {
    const expected = { id: 42, title: 'NestJS' };
    postSpy.mockResolvedValueOnce({ data: expected });

    const result = await client.send({ cmd: 'GET_COURSE' }, { id: 42 });

    expect(result).toEqual(expected);
  });
});
