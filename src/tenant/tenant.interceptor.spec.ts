/**
 * Unit tests for BaseTenantInterceptor — the centralised header cross-check
 * and BU tenant context wiring.
 *
 * Security properties verified
 * ============================
 * 1. SERVER buId is AUTHORITATIVE — never the header alone.
 * 2. Header present + server match  → server buId used (not header value).
 * 3. Header present + server mismatch → 403 ForbiddenException.
 * 4. Header present + NO server buId → header ignored, no BU context (no 403).
 * 5. No header                       → server buId used directly.
 * 6. Non-UUID header                 → header ignored, server buId used.
 * 7. Array header                    → first element used for comparison.
 * 8. Skip metadata (any configured key) → request forwarded, no resolution.
 * 9. ALS context is set to the resolved buId inside the handler.
 * 10. ALS context is absent AFTER the observable completes.
 * 11. failOnMissingBu=true → 403 when resolver returns undefined.
 * 12. failOnMissingBu=false (default) → skip-with-log when resolver returns undefined.
 */
import { ForbiddenException } from '@nestjs/common';
import { ExecutionContext, CallHandler } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { of } from 'rxjs';
import { BaseTenantInterceptor } from './tenant.interceptor';
import { BuResolver } from './bu-resolver.interface';
import { getBuId } from './tenant-context';
import { SKIP_TENANT_KEY } from './skip-tenant.decorator';

const SAMPLE_UUID = '3f47e9a0-1234-5678-abcd-ef0123456789';
const OTHER_UUID  = 'aaaabbbb-cccc-dddd-eeee-ffffaaaabbbb';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeResolver(serverBuId: string | undefined): BuResolver {
  return { resolveServerBuId: jest.fn().mockResolvedValue(serverBuId) };
}

function makeReflector(skipValue: boolean): Reflector {
  return { getAllAndOverride: jest.fn().mockReturnValue(skipValue) } as unknown as Reflector;
}

function buildContext(reqFields: Record<string, unknown>): ExecutionContext {
  const req = { headers: {}, ...reqFields };
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler:   () => ({}),
    getClass:     () => ({}),
  } as unknown as ExecutionContext;
}

function makeInterceptor(
  serverBuId: string | undefined,
  isSkip = false,
  opts: { failOnMissingBu?: boolean } = {},
): BaseTenantInterceptor {
  return new BaseTenantInterceptor(
    makeReflector(isSkip),
    makeResolver(serverBuId),
    [SKIP_TENANT_KEY],
    opts,
  );
}

async function runInterceptor(
  reqFields: Record<string, unknown>,
  serverBuId: string | undefined,
  isSkip = false,
  opts: { failOnMissingBu?: boolean } = {},
): Promise<{ buId: string | undefined; error?: unknown }> {
  const interceptor = makeInterceptor(serverBuId, isSkip, opts);
  const ctx = buildContext(reqFields);

  let capturedBuId: string | undefined;
  const captureHandler: CallHandler = {
    handle: () => {
      capturedBuId = getBuId();
      return of('ok');
    },
  };

  return new Promise((resolve) => {
    interceptor.intercept(ctx, captureHandler).then(
      (obs$) => {
        obs$.subscribe({
          complete: () => resolve({ buId: capturedBuId }),
          error:    (e) => resolve({ buId: capturedBuId, error: e }),
        });
      },
      (e) => resolve({ buId: capturedBuId, error: e }),
    );
  });
}

// ---------------------------------------------------------------------------
// _validateHeaderAndGetBuId — white-box unit tests for the security kernel
// ---------------------------------------------------------------------------

describe('BaseTenantInterceptor._validateHeaderAndGetBuId (centralised security check)', () => {
  function make(serverBuId: string | undefined) {
    return new BaseTenantInterceptor(
      makeReflector(false),
      makeResolver(serverBuId),
    );
  }

  // ── No header ─────────────────────────────────────────────────────────────
  it('returns server buId when no header is present', () => {
    expect(make(SAMPLE_UUID)._validateHeaderAndGetBuId(
      { headers: {} } as any, SAMPLE_UUID,
    )).toBe(SAMPLE_UUID);
  });

  it('returns undefined when no header and no server buId', () => {
    expect(make(undefined)._validateHeaderAndGetBuId(
      { headers: {} } as any, undefined,
    )).toBeUndefined();
  });

  // ── Header matches server buId ─────────────────────────────────────────────
  it('returns the SERVER buId (not the header) when header matches', () => {
    const result = make(SAMPLE_UUID)._validateHeaderAndGetBuId(
      { headers: { 'x-business-bu-id': SAMPLE_UUID } } as any, SAMPLE_UUID,
    );
    expect(result).toBe(SAMPLE_UUID);
  });

  it('case-insensitive match: lowercase header vs uppercase server buId still passes', () => {
    const upper = SAMPLE_UUID.toUpperCase();
    const result = make(upper)._validateHeaderAndGetBuId(
      { headers: { 'x-business-bu-id': SAMPLE_UUID } } as any, upper,
    );
    expect(result).toBe(upper);
  });

  // ── Header mismatches server buId → 403 ────────────────────────────────────
  it('throws ForbiddenException when header does not match server buId', () => {
    expect(() =>
      make(SAMPLE_UUID)._validateHeaderAndGetBuId(
        { headers: { 'x-business-bu-id': OTHER_UUID } } as any, SAMPLE_UUID,
      ),
    ).toThrow(ForbiddenException);
  });

  it('ForbiddenException message references x-business-bu-id', () => {
    let msg = '';
    try {
      make(SAMPLE_UUID)._validateHeaderAndGetBuId(
        { headers: { 'x-business-bu-id': OTHER_UUID } } as any, SAMPLE_UUID,
      );
    } catch (e) { msg = (e as Error).message; }
    expect(msg).toMatch(/x-business-bu-id/);
  });

  // ── Header present but NO server buId → ignore header ─────────────────────
  it('returns undefined (ignores header) when header is present but server buId is absent', () => {
    // SECURITY: must NOT accept header as authority without server confirmation.
    const result = make(undefined)._validateHeaderAndGetBuId(
      { headers: { 'x-business-bu-id': SAMPLE_UUID } } as any, undefined,
    );
    expect(result).toBeUndefined();
  });

  // ── Non-UUID header → treated as absent ─────────────────────────────────
  it('ignores non-UUID header and returns server buId', () => {
    const result = make(SAMPLE_UUID)._validateHeaderAndGetBuId(
      { headers: { 'x-business-bu-id': 'not-a-uuid' } } as any, SAMPLE_UUID,
    );
    expect(result).toBe(SAMPLE_UUID);
  });

  // ── Array header → first element used ───────────────────────────────────
  it('uses first element of array header for comparison (match)', () => {
    const result = make(SAMPLE_UUID)._validateHeaderAndGetBuId(
      { headers: { 'x-business-bu-id': [SAMPLE_UUID, OTHER_UUID] } } as any, SAMPLE_UUID,
    );
    expect(result).toBe(SAMPLE_UUID);
  });

  it('throws 403 when first element of array header mismatches server buId', () => {
    expect(() =>
      make(SAMPLE_UUID)._validateHeaderAndGetBuId(
        { headers: { 'x-business-bu-id': [OTHER_UUID, SAMPLE_UUID] } } as any, SAMPLE_UUID,
      ),
    ).toThrow(ForbiddenException);
  });
});

// ---------------------------------------------------------------------------
// intercept() — Observable pipeline + ALS integration
// ---------------------------------------------------------------------------

describe('BaseTenantInterceptor.intercept', () => {

  describe('Skip metadata — request forwarded without tenant resolution', () => {
    it('forwards request without resolving buId when skip key is true', async () => {
      const { buId, error } = await runInterceptor({ headers: {} }, SAMPLE_UUID, true);
      expect(error).toBeUndefined();
      expect(buId).toBeUndefined(); // ALS not populated
    });

    it('does NOT call resolver when skip is active', async () => {
      const resolver = makeResolver(SAMPLE_UUID);
      const interceptor = new BaseTenantInterceptor(makeReflector(true), resolver);
      const ctx = buildContext({ headers: {} });
      const obs$ = await interceptor.intercept(ctx, { handle: () => of('ok') });
      obs$.subscribe();
      expect(resolver.resolveServerBuId).not.toHaveBeenCalled();
    });

    it('does NOT throw 403 for header mismatch when skip is active', async () => {
      const { error } = await runInterceptor(
        { headers: { 'x-business-bu-id': OTHER_UUID } },
        SAMPLE_UUID,
        true,
      );
      expect(error).toBeUndefined();
    });
  });

  describe('Normal path — server buId resolves and ALS is set', () => {
    it('sets ALS buId from server-derived value when no header', async () => {
      const { buId } = await runInterceptor({ headers: {} }, SAMPLE_UUID);
      expect(buId).toBe(SAMPLE_UUID);
    });

    it('sets ALS buId from server-derived value when header matches', async () => {
      const { buId } = await runInterceptor(
        { headers: { 'x-business-bu-id': SAMPLE_UUID } },
        SAMPLE_UUID,
      );
      expect(buId).toBe(SAMPLE_UUID);
    });

    it('ALS context is cleared after the observable completes', async () => {
      await runInterceptor({ headers: {} }, SAMPLE_UUID);
      expect(getBuId()).toBeUndefined();
    });
  });

  describe('Header mismatch → 403', () => {
    it('throws ForbiddenException when header differs from server buId', async () => {
      const { error } = await runInterceptor(
        { headers: { 'x-business-bu-id': OTHER_UUID } },
        SAMPLE_UUID,
      );
      expect(error).toBeInstanceOf(ForbiddenException);
    });
  });

  describe('Null / absent server buId (pre-backfill) — skip-with-log, NOT 403', () => {
    it('does NOT throw when resolver returns undefined (default failOnMissingBu=false)', async () => {
      const { error } = await runInterceptor({ headers: {} }, undefined);
      expect(error).toBeUndefined();
    });

    it('getBuId() is undefined when resolver returns undefined', async () => {
      const { buId } = await runInterceptor({ headers: {} }, undefined);
      expect(buId).toBeUndefined();
    });

    it('does NOT throw when header present but resolver returns undefined', async () => {
      // Header cannot be trusted — resolver has no server value to compare against.
      const { error } = await runInterceptor(
        { headers: { 'x-business-bu-id': SAMPLE_UUID } },
        undefined,
      );
      expect(error).toBeUndefined();
    });

    it('getBuId() is undefined even when header is present but no server buId', async () => {
      const { buId } = await runInterceptor(
        { headers: { 'x-business-bu-id': SAMPLE_UUID } },
        undefined,
      );
      expect(buId).toBeUndefined();
    });
  });

  describe('failOnMissingBu=true — strict mode for internal routes', () => {
    it('throws ForbiddenException when resolver returns undefined and failOnMissingBu=true', async () => {
      const { error } = await runInterceptor({ headers: {} }, undefined, false, { failOnMissingBu: true });
      expect(error).toBeInstanceOf(ForbiddenException);
    });

    it('does NOT throw when resolver returns a valid buId and failOnMissingBu=true', async () => {
      const { error } = await runInterceptor({ headers: {} }, SAMPLE_UUID, false, { failOnMissingBu: true });
      expect(error).toBeUndefined();
    });
  });

  describe('Multiple skipMetadataKeys — any key triggers skip', () => {
    it('skips when the second key in skipMetadataKeys is truthy', async () => {
      const IS_PUBLIC_KEY = 'isPublic';
      const reflector = {
        getAllAndOverride: jest.fn().mockImplementation((key: string) => key === IS_PUBLIC_KEY),
      } as unknown as Reflector;
      const resolver = makeResolver(SAMPLE_UUID);
      const interceptor = new BaseTenantInterceptor(reflector, resolver, [SKIP_TENANT_KEY, IS_PUBLIC_KEY]);

      const ctx = buildContext({ headers: {} });
      let handlerCalled = false;
      const obs$ = await interceptor.intercept(ctx, {
        handle: () => { handlerCalled = true; return of('ok'); },
      });
      obs$.subscribe();

      expect(handlerCalled).toBe(true);
      expect(resolver.resolveServerBuId).not.toHaveBeenCalled();
    });
  });
});
