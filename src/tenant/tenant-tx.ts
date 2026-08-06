/**
 * tenant-tx.ts — RLS-enforced transactional helper
 *
 * Security model
 * --------------
 * PostgreSQL superusers and BYPASSRLS roles bypass Row Level Security even
 * when FORCE ROW LEVEL SECURITY is set on a table.  To guarantee per-BU
 * isolation regardless of the base connection role, this helper issues
 * `SET LOCAL ROLE <app_role>` as the FIRST statement in every transaction.
 * `SET LOCAL` is scoped to the transaction, so the downgrade is automatically
 * reverted on commit/rollback — no cleanup required.
 *
 * Deployment requirement
 * ----------------------
 * The application DB user MUST satisfy ONE of these conditions:
 *   (a) Is a non-superuser without BYPASSRLS — the role switch is a no-op
 *       (or a same-role switch) and RLS already applies.
 *   (b) Is a privileged role (superuser / BYPASSRLS) — it MUST be GRANTed
 *       membership in the app role (e.g. `GRANT app_user TO postgres`) so
 *       that `SET LOCAL ROLE app_user` succeeds and downgrades privileges
 *       for the duration of the transaction.
 * The app role (DB_APP_ROLE env var, default "app_user") must have
 * SELECT/INSERT/UPDATE/DELETE grants on all relevant tables — created in
 * the foundation migrations of each service.
 */

import type { DataSource, EntityManager } from 'typeorm';

/** Identifier-safe role name: lowercase letter/underscore start, then [a-z0-9_] */
const SAFE_ROLE_RE = /^[a-z_][a-z0-9_]*$/;

/**
 * Validates that `role` is a safe SQL identifier before interpolation into
 * a SET LOCAL ROLE statement.  SET ROLE cannot use a bind parameter, so we
 * validate-then-interpolate.  `role` comes from server config (DB_APP_ROLE /
 * opts.role), never from user input — but we validate defensively.
 *
 * @throws {Error} if `role` contains characters outside [a-z0-9_] or starts
 *   with a digit.
 */
export function assertSafeRoleIdent(role: string): void {
  if (!SAFE_ROLE_RE.test(role)) {
    throw new Error(
      `[tenant-tx] Unsafe DB role identifier rejected: "${role}". ` +
        `Must match ^[a-z_][a-z0-9_]*$ (no quotes, uppercase, or special chars). ` +
        `Check DB_APP_ROLE in your environment configuration.`,
    );
  }
}

/**
 * Runs `work` inside a TypeORM transaction with:
 *   1. `SET LOCAL ROLE <role>` — downgrades to a non-superuser role so RLS
 *      is enforced regardless of the base connection's privileges.  RLS is
 *      enforced because this helper switches to a non-superuser role
 *      (DB_APP_ROLE); the app's connection role MUST be able to SET ROLE to
 *      it (i.e. be a member of it via GRANT).
 *   2. `set_config('app.current_bu', buId, true)` — scopes the GUC to this
 *      transaction so the RLS policy can read `current_setting('app.current_bu')`.
 *      buId is passed as a BIND PARAMETER ($1), never string-interpolated.
 *
 * Both settings are transaction-local and revert automatically on
 * commit/rollback.
 *
 * @param ds      The TypeORM DataSource.  May connect as any role, including a
 *                superuser — this helper enforces least-privilege per-transaction.
 * @param buId    The BU UUID to inject into `app.current_bu`.
 * @param work    The unit of work to run inside the transaction.
 * @param opts.role  Override the DB role to switch to (default: DB_APP_ROLE
 *                env var, or "app_user").  The base connection must be GRANTed
 *                membership in this role.
 */
export async function withTenantTx<T>(
  ds: DataSource,
  buId: string,
  work: (m: EntityManager) => Promise<T>,
  opts?: { role?: string },
): Promise<T> {
  const role = opts?.role ?? process.env.DB_APP_ROLE ?? 'app_user';

  // Validate before interpolation — SET ROLE does not accept bind params.
  assertSafeRoleIdent(role);

  return ds.transaction(async (m) => {
    // Downgrade to a non-superuser role so RLS is enforced even when the
    // base connection is postgres (superuser) or has BYPASSRLS.
    // SET LOCAL is transaction-scoped; the role reverts on commit/rollback.
    await m.query(`SET LOCAL ROLE ${role}`);

    // Inject BU context as a transaction-local GUC for the RLS policy.
    // local=true → reverts when the transaction ends.
    // buId is a BIND PARAMETER ($1) — never interpolated into the SQL string.
    await m.query("SELECT set_config('app.current_bu', $1, true)", [buId]);

    return work(m);
  });
}
