/**
 * Unit tests for withTenantTx and assertSafeRoleIdent.
 *
 * Key security properties verified:
 *   1. buId is passed as a bind parameter ($1), never string-interpolated.
 *   2. Role name is validated with assertSafeRoleIdent before any SQL is
 *      issued; an unsafe role throws before the transaction opens.
 *   3. SET LOCAL ROLE is issued before set_config (ordering matters: role
 *      downgrade must precede GUC injection so the policy runs under the
 *      correct role).
 *   4. The work callback's return value propagates through the transaction.
 *   5. DB_APP_ROLE env var is respected; 'app_user' is the default.
 */
import type { DataSource, EntityManager } from 'typeorm';
import { assertSafeRoleIdent, withTenantTx } from './tenant-tx';

const SAMPLE_BU = '3f47e9a0-1234-5678-abcd-ef0123456789';

interface CapturedQuery {
  sql: string;
  params?: unknown[];
}

function buildMockDs(): { ds: DataSource; queries: CapturedQuery[]; mockManager: EntityManager } {
  const queries: CapturedQuery[] = [];
  const mockManager = {
    query: jest.fn().mockImplementation((sql: string, params?: unknown[]) => {
      queries.push({ sql, params });
      return Promise.resolve([]);
    }),
  } as unknown as EntityManager;

  const ds = {
    transaction: jest.fn().mockImplementation(async (fn: (em: EntityManager) => Promise<unknown>) => fn(mockManager)),
  } as unknown as DataSource;

  return { ds, queries, mockManager };
}

// ---------------------------------------------------------------------------
// assertSafeRoleIdent
// ---------------------------------------------------------------------------

describe('assertSafeRoleIdent — role identifier validation', () => {
  const valid = ['app_user', 'payment_app_user', 'a', '_role123', 'role_a_b'];

  it.each(valid)('accepts safe identifier: %s', (role) => {
    expect(() => assertSafeRoleIdent(role)).not.toThrow();
  });

  const invalid = [
    '123start', // starts with digit
    'UPPERCASE', // uppercase
    'has space', // space
    'has-dash', // hyphen
    "role'; DROP", // SQL injection attempt
    '"quoted"', // double-quoted
    '', // empty string
  ];

  it.each(invalid)('rejects unsafe identifier: %s', (role) => {
    expect(() => assertSafeRoleIdent(role)).toThrow(/Unsafe DB role identifier/);
  });
});

// ---------------------------------------------------------------------------
// withTenantTx — role and GUC setup
// ---------------------------------------------------------------------------

describe('withTenantTx', () => {
  it('opens a TypeORM transaction', async () => {
    const { ds } = buildMockDs();
    await withTenantTx(ds, SAMPLE_BU, async () => 'ok');
    expect(ds.transaction).toHaveBeenCalledTimes(1);
  });

  it('issues SET LOCAL ROLE as the first query using the default role (app_user)', async () => {
    const savedEnv = process.env.DB_APP_ROLE;
    delete process.env.DB_APP_ROLE;
    try {
      const { ds, queries } = buildMockDs();
      await withTenantTx(ds, SAMPLE_BU, async () => 'done');
      expect(queries[0].sql).toBe('SET LOCAL ROLE app_user');
      expect(queries[0].params).toBeUndefined();
    } finally {
      if (savedEnv !== undefined) process.env.DB_APP_ROLE = savedEnv;
      else delete process.env.DB_APP_ROLE;
    }
  });

  it('respects DB_APP_ROLE env var', async () => {
    process.env.DB_APP_ROLE = 'payment_app_user';
    try {
      const { ds, queries } = buildMockDs();
      await withTenantTx(ds, SAMPLE_BU, async () => 'done');
      expect(queries[0].sql).toBe('SET LOCAL ROLE payment_app_user');
    } finally {
      delete process.env.DB_APP_ROLE;
    }
  });

  it('opts.role overrides the env var and default', async () => {
    const { ds, queries } = buildMockDs();
    await withTenantTx(ds, SAMPLE_BU, async () => 'done', { role: 'custom_app_role' });
    expect(queries[0].sql).toBe('SET LOCAL ROLE custom_app_role');
  });

  it('passes buId as a BIND PARAMETER ($1), not interpolated into SQL', async () => {
    const { ds, queries } = buildMockDs();
    await withTenantTx(ds, SAMPLE_BU, async () => null);

    const setConfigQuery = queries.find((q) => q.sql.includes('set_config'));
    expect(setConfigQuery).toBeDefined();
    expect(setConfigQuery!.params).toEqual([SAMPLE_BU]);
    expect(setConfigQuery!.sql).not.toContain(SAMPLE_BU);
  });

  it('uses a $1 placeholder in the set_config SQL', async () => {
    const { ds, queries } = buildMockDs();
    await withTenantTx(ds, SAMPLE_BU, async () => null);

    const setConfigQuery = queries.find((q) => q.sql.includes('set_config'));
    expect(setConfigQuery!.sql).toContain('$1');
  });

  it('scopes the GUC to the transaction (local=true as third argument)', async () => {
    const { ds, queries } = buildMockDs();
    await withTenantTx(ds, SAMPLE_BU, async () => null);

    const setConfigQuery = queries.find((q) => q.sql.includes('set_config'));
    // set_config(key, value, is_local) — third arg true scopes to transaction.
    expect(setConfigQuery!.sql).toContain('true');
  });

  it('issues SET LOCAL ROLE BEFORE set_config (ordering is security-critical)', async () => {
    const { ds, queries } = buildMockDs();
    await withTenantTx(ds, SAMPLE_BU, async () => null, { role: 'app_user' });

    const roleIdx = queries.findIndex((q) => q.sql.includes('SET LOCAL ROLE'));
    const gucIdx = queries.findIndex((q) => q.sql.includes('set_config'));
    expect(roleIdx).toBeGreaterThanOrEqual(0);
    expect(gucIdx).toBeGreaterThanOrEqual(0);
    expect(roleIdx).toBeLessThan(gucIdx);
  });

  it('does not open a transaction when the role is invalid', async () => {
    const { ds } = buildMockDs();
    await expect(withTenantTx(ds, SAMPLE_BU, async () => null, { role: 'BAD ROLE' })).rejects.toThrow(
      /Unsafe DB role identifier/,
    );
    expect((ds.transaction as jest.Mock).mock.calls).toHaveLength(0);
  });

  it('returns the value produced by the work callback', async () => {
    const { ds } = buildMockDs();
    const result = await withTenantTx(ds, SAMPLE_BU, async () => 42);
    expect(result).toBe(42);
  });

  it('propagates errors thrown inside the work callback', async () => {
    const { ds } = buildMockDs();
    await expect(
      withTenantTx(ds, SAMPLE_BU, async () => {
        throw new Error('work failed');
      }),
    ).rejects.toThrow('work failed');
  });

  it('passes the EntityManager to the work callback', async () => {
    const { ds, mockManager } = buildMockDs();
    let capturedEm: EntityManager | undefined;
    await withTenantTx(ds, SAMPLE_BU, async (em) => {
      capturedEm = em;
    });
    expect(capturedEm).toBe(mockManager);
  });

  it('opens a fresh transaction per call — no cross-request GUC leakage', async () => {
    const BU_A = '11111111-0000-0000-0000-000000000000';
    const BU_B = '22222222-0000-0000-0000-000000000000';
    const capturedBuIds: string[] = [];

    const ds = {
      transaction: jest.fn().mockImplementation(async (fn: (em: EntityManager) => Promise<unknown>) => {
        const em = {
          query: jest.fn().mockImplementation((sql: string, params?: unknown[]) => {
            if (sql.includes('set_config')) capturedBuIds.push(params![0] as string);
            return Promise.resolve([]);
          }),
        } as unknown as EntityManager;
        return fn(em);
      }),
    } as unknown as DataSource;

    await withTenantTx(ds, BU_A, async () => null);
    await withTenantTx(ds, BU_B, async () => null);

    expect(capturedBuIds).toEqual([BU_A, BU_B]);
  });
});
