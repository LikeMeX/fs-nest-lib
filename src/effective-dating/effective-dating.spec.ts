import { IsNull, LessThanOrEqual, Or } from 'typeorm';
import { asOfSqlWhere, asOfWhere, currentWhere } from './effective-dated.entity';

test('currentWhere selects open rows', () => {
  expect(currentWhere()).toEqual({ effectiveTo: IsNull() });
});

describe('asOfWhere', () => {
  const date = new Date('2024-06-01T00:00:00Z');

  it('returns effectiveFrom LessThanOrEqual(asOf)', () => {
    const where = asOfWhere(date);
    expect(where.effectiveFrom).toEqual(LessThanOrEqual(date));
  });

  it('returns effectiveTo as Or(IsNull(), LessThanOrEqual(asOf))', () => {
    const where = asOfWhere(date);
    // The Or() wrapper should combine IsNull and LessThanOrEqual
    expect(where.effectiveTo).toEqual(Or(IsNull(), LessThanOrEqual(date)));
  });

  it('uses the exact date passed (no mutation)', () => {
    const d1 = new Date('2024-01-01T00:00:00Z');
    const d2 = new Date('2024-06-01T00:00:00Z');
    const w1 = asOfWhere(d1);
    const w2 = asOfWhere(d2);
    // The two predicates must be different objects referencing their respective dates
    expect(w1.effectiveFrom).not.toEqual(w2.effectiveFrom);
  });
});

describe('asOfSqlWhere', () => {
  const date = new Date('2024-06-01T00:00:00Z');

  it('returns a clause with the default startIdx=1', () => {
    const { clause, params } = asOfSqlWhere(date);
    expect(clause).toBe('effective_from <= $1 AND (effective_to IS NULL OR effective_to > $1)');
    expect(params).toEqual([date]);
  });

  it('uses the provided startIdx', () => {
    const { clause, params } = asOfSqlWhere(date, 3);
    expect(clause).toBe('effective_from <= $3 AND (effective_to IS NULL OR effective_to > $3)');
    expect(params).toEqual([date]);
  });

  it('params array contains exactly the asOf date', () => {
    const { params } = asOfSqlWhere(date, 1);
    expect(params).toHaveLength(1);
    expect(params[0]).toBe(date);
  });
});
