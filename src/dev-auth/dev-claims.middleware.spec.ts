/**
 * Unit tests for DevClaimsMiddleware
 *
 * Tests run in NODE_ENV=test so the production guard does not fire.
 * DEV_AUTH_SHIM is set per-test.
 */

import type { Request, Response } from 'express';
import { decodeJwtPayload, setIfAbsent } from './dev-claims.middleware';

// ─── helpers ────────────────────────────────────────────────────────────────

/** Build a minimal fake JWT with the given payload (no real sig). */
function fakeJwt(payload: object): string {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.fakesig`;
}

function fakeReq(overrides: Partial<Request> & { headers?: Record<string, string> }): Request {
  return { headers: {}, ...overrides } as unknown as Request;
}

function fakeRes(): Response {
  return {} as Response;
}

// ─── decodeJwtPayload ───────────────────────────────────────────────────────

describe('decodeJwtPayload', () => {
  it('decodes a valid JWT payload', () => {
    const payload = { id: 42, businessId: 7, businessMemberId: 99 };
    const token = fakeJwt(payload);
    expect(decodeJwtPayload(token)).toEqual(payload);
  });

  it('returns null for a malformed token (single segment)', () => {
    expect(decodeJwtPayload('notavalidjwt')).toBeNull();
  });

  it('returns null for a token with non-json payload', () => {
    expect(decodeJwtPayload('header.!!!.sig')).toBeNull();
  });

  it('handles base64url padding correctly', () => {
    const payload = { id: 1 };
    const token = fakeJwt(payload);
    expect(decodeJwtPayload(token)?.id).toBe(1);
  });
});

// ─── setIfAbsent ────────────────────────────────────────────────────────────

describe('setIfAbsent', () => {
  it('sets the header when absent', () => {
    const req = fakeReq({ headers: {} });
    setIfAbsent(req, 'x-user', '123');
    expect(req.headers['x-user']).toBe('123');
  });

  it('does NOT overwrite an existing non-empty header', () => {
    const req = fakeReq({ headers: { 'x-user': '999' } });
    setIfAbsent(req, 'x-user', '123');
    expect(req.headers['x-user']).toBe('999');
  });

  it('does nothing when value is undefined', () => {
    const req = fakeReq({ headers: {} });
    setIfAbsent(req, 'x-user', undefined);
    expect(req.headers['x-user']).toBeUndefined();
  });

  it('replaces an empty-string header', () => {
    const req = fakeReq({ headers: { 'x-user': '' } });
    setIfAbsent(req, 'x-user', '42');
    expect(req.headers['x-user']).toBe('42');
  });
});

// ─── DevClaimsMiddleware (integration via class instantiation) ───────────────

describe('DevClaimsMiddleware.use', () => {
  let origShim: string | undefined;
  let origNodeEnv: string | undefined;

  beforeEach(() => {
    origShim = process.env.DEV_AUTH_SHIM;
    origNodeEnv = process.env.NODE_ENV;
    // Ensure safe env for instantiation
    process.env.NODE_ENV = 'test';
  });

  afterEach(() => {
    process.env.DEV_AUTH_SHIM = origShim;
    process.env.NODE_ENV = origNodeEnv;
  });

  function buildMiddleware() {
    // Import inline so env is read at construction time
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { DevClaimsMiddleware } = require('./dev-claims.middleware');
    return new DevClaimsMiddleware();
  }

  it('injects all identity headers from JWT when shim is active', () => {
    process.env.DEV_AUTH_SHIM = '1';
    const mw = buildMiddleware();

    const payload = {
      id: 10,
      businessMemberId: 20,
      businessBuId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      businessId: 5,
      businessRole: 3,
    };
    const req = fakeReq({ headers: { authorization: `Bearer ${fakeJwt(payload)}` } });
    const next = jest.fn();

    mw.use(req, fakeRes(), next);

    expect(req.headers['x-user']).toBe('10');
    expect(req.headers['x-business-member']).toBe('20');
    // businessBuId takes precedence over businessId
    expect(req.headers['x-business']).toBe('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
    expect(req.headers['x-business-role']).toBe('3');
    expect(next).toHaveBeenCalled();
  });

  it('falls back to numeric businessId when businessBuId is absent', () => {
    process.env.DEV_AUTH_SHIM = '1';
    const mw = buildMiddleware();

    const payload = { id: 10, businessId: 7 };
    const req = fakeReq({ headers: { authorization: `Bearer ${fakeJwt(payload)}` } });
    const next = jest.fn();

    mw.use(req, fakeRes(), next);
    expect(req.headers['x-business']).toBe('7');
  });

  it('does NOT overwrite pre-existing headers', () => {
    process.env.DEV_AUTH_SHIM = '1';
    const mw = buildMiddleware();

    const payload = { id: 10, businessId: 7 };
    const req = fakeReq({
      headers: {
        authorization: `Bearer ${fakeJwt(payload)}`,
        'x-user': '999',
      },
    });
    const next = jest.fn();

    mw.use(req, fakeRes(), next);
    expect(req.headers['x-user']).toBe('999');
  });

  it('is a no-op when DEV_AUTH_SHIM !== "1"', () => {
    process.env.DEV_AUTH_SHIM = '0';
    const mw = buildMiddleware();

    const payload = { id: 10 };
    const req = fakeReq({ headers: { authorization: `Bearer ${fakeJwt(payload)}` } });
    const next = jest.fn();

    mw.use(req, fakeRes(), next);
    expect(req.headers['x-user']).toBeUndefined();
    expect(next).toHaveBeenCalled();
  });

  it('is a no-op when no Authorization header', () => {
    process.env.DEV_AUTH_SHIM = '1';
    const mw = buildMiddleware();

    const req = fakeReq({ headers: {} });
    const next = jest.fn();
    mw.use(req, fakeRes(), next);
    expect(req.headers['x-user']).toBeUndefined();
    expect(next).toHaveBeenCalled();
  });
});
