import { Column, IsNull, LessThanOrEqual, Or } from 'typeorm';

export abstract class EffectiveDated {
  @Column({ name: 'effective_from', type: 'timestamptz', default: () => 'now()' })
  effectiveFrom: Date;

  @Column({ name: 'effective_to', type: 'timestamptz', nullable: true })
  effectiveTo: Date | null;
}

/**
 * currentWhere — TypeORM find-options predicate for "currently active" rows.
 *
 * Selects rows where effective_to IS NULL (open-ended, no expiry date).
 */
export function currentWhere() {
  return { effectiveTo: IsNull() };
}

/**
 * asOfWhere — TypeORM find-options predicate for time-travel queries.
 *
 * Returns the predicate:
 *   effective_from <= asOf AND (effective_to IS NULL OR effective_to > asOf)
 *
 * This selects rows that were active at the given point in time:
 *   - The row had already started (effective_from <= asOf).
 *   - The row had not yet expired (effective_to IS NULL = open-ended,
 *     OR effective_to > asOf = not yet closed at that moment).
 *
 * Usage with TypeORM Repository:
 *   repo.find({ where: { ...asOfWhere(date), buId } })
 *
 * Usage in raw SQL (preferred for complex joins):
 *   Use asOfSqlWhere() for the parameterized SQL fragment instead.
 *
 * @param asOf  The point-in-time date to evaluate effective dating against.
 */
export function asOfWhere(asOf: Date) {
  return {
    effectiveFrom: LessThanOrEqual(asOf),
    effectiveTo: Or(IsNull(), LessThanOrEqual(asOf)),
  };
}

/**
 * asOfSqlWhere — returns a parameterized SQL fragment + parameter array
 * for use in raw SQL queries (em.query / DataSource.query).
 *
 * Returns:
 *   { clause: string, params: [asOf] }
 *
 * The clause uses positional parameters starting from `startIdx` (default 1):
 *   effective_from <= $1 AND (effective_to IS NULL OR effective_to > $1)
 *
 * Usage:
 *   const { clause, params } = asOfSqlWhere(myDate, 1);
 *   em.query(`SELECT * FROM member_assignment WHERE ${clause} AND bu_id = $2`,
 *            [...params, buId])
 *
 * @param asOf      The point-in-time date.
 * @param startIdx  The positional parameter index to use (default 1).
 */
export function asOfSqlWhere(asOf: Date, startIdx = 1): { clause: string; params: [Date] } {
  const clause = `effective_from <= $${startIdx} AND ` + `(effective_to IS NULL OR effective_to > $${startIdx})`;
  return { clause, params: [asOf] };
}
