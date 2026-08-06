import { getTenant, requireBu, runWithTenant } from './tenant-context';

describe('tenant-context', () => {
  it('exposes the tenant inside runWithTenant and nothing outside', () => {
    expect(getTenant()).toBeUndefined();
    runWithTenant({ buId: 'bu_crc', scopes: [{ kind: 'all' }] }, () => {
      expect(requireBu()).toBe('bu_crc');
      expect(getTenant()?.scopes[0].kind).toBe('all');
    });
    expect(getTenant()).toBeUndefined();
  });
  it('requireBu throws outside a tenant scope', () => {
    expect(() => requireBu()).toThrow();
  });
});
