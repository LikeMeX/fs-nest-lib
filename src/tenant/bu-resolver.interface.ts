import type { Request } from 'express';

/** RFC 4122 UUID (case-insensitive). */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * BuResolver — pluggable server-side BU UUID resolution.
 *
 * SECURITY CONTRACT
 * -----------------
 * Implementations MUST return a buId that was derived from a SERVER-SIDE source
 * (DB lookup via guard, JWT claim validated by a guard, etc.).
 *
 * Implementations MUST NOT return a buId that came exclusively from the
 * `x-business-bu-id` request header — the header is a consistency check only
 * and is validated against the server value centrally in BaseTenantInterceptor.
 * Returning a header-only value here bypasses that security check.
 *
 * The sole exception is HeaderBuResolver below, which is explicitly documented
 * as opt-in for SUPER_ADMIN / internal-service routes where the network
 * boundary is the trust enforcer.
 */
export interface BuResolver {
  /**
   * Resolve the server-authoritative BU UUID for this request.
   *
   * @returns The BU UUID string, or undefined if no BU context is available
   *   (pre-backfill, route not BU-scoped, or BU context not yet established
   *   by a guard).  Undefined triggers skip-with-log in BaseTenantInterceptor
   *   rather than a 403.
   *
   * @throws Any error thrown here propagates out of the interceptor pipeline.
   *   Throw deliberately for hard failure cases (e.g. DB error during lookup).
   */
  resolveServerBuId(req: Request): Promise<string | undefined>;
}

/**
 * HeaderBuResolver — opt-in resolver for SUPER_ADMIN and internal-service routes.
 *
 * Reads the BU UUID DIRECTLY from the `x-business-bu-id` request header.
 *
 * SECURITY WARNING
 * ----------------
 * This resolver is safe ONLY when applied behind a guard that enforces a trust
 * boundary:
 *   - InternalGuard (INTERNAL_TOKEN validation) — for service-to-service routes
 *   - SUPER_ADMIN role check in a guard — for cross-BU platform-admin routes
 *
 * Do NOT use this resolver on end-user-facing routes.  The network boundary
 * (internal cluster routing) is the trust enforcer, NOT the header value.
 *
 * When the interceptor is configured with this resolver, the header is treated
 * as the "server value" and the centralized cross-check trivially passes
 * (header === resolver output).  That is intentional — the header IS the
 * authority for these routes.
 *
 * @example
 *   // In an @InternalController that is guarded by InternalGuard:
 *   export class InternalTenantInterceptor extends BaseTenantInterceptor {
 *     constructor(reflector: Reflector) {
 *       super(reflector, new HeaderBuResolver(), [SKIP_TENANT_KEY], { failOnMissingBu: true });
 *     }
 *   }
 */
export class HeaderBuResolver implements BuResolver {
  async resolveServerBuId(req: Request): Promise<string | undefined> {
    const rawHeader = req.headers['x-business-bu-id'];
    const headerBuId = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
    if (!headerBuId || !UUID_RE.test(headerBuId)) return undefined;
    return headerBuId;
  }
}
