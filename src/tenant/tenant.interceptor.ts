/**
 * tenant.interceptor.ts — Base NestJS interceptor for per-request BU tenant
 * context wiring with a pluggable server-side BU resolver.
 *
 * WHY THIS EXISTS
 * ---------------
 * The security check "header x-business-bu-id must match the server-derived
 * buId, and a header value alone is never authoritative" was copy-pasted into
 * four services and got wrong each time.  This interceptor centralises that
 * check ONCE so it cannot diverge.
 *
 * DESIGN
 * ------
 * BU identity resolution has two distinct concerns:
 *
 *   1. SERVER-SIDE RESOLUTION (pluggable via BuResolver):
 *      Each service resolves the authoritative buId from a different source:
 *        - fs-learn-api:    req.businessBuId (set by PoliciesGuard from JWT)
 *        - fs-assessment:   req.businessBuId (set by UserBusinessGuard from workspace.bu_id)
 *        - fs-payment-api:  req.merchant.buId (set by MerchantGuard from DB)
 *      The resolver is injected; this interceptor does not know which is which.
 *
 *   2. HEADER CROSS-CHECK (centralised here, not pluggable):
 *      If `x-business-bu-id` is present, it MUST equal the server-derived value
 *      (case-insensitive) or the request is rejected with 403.  A header value
 *      is NEVER used without a server value to confirm it — this prevents
 *      cross-BU impersonation from callers that bypass the KrakenD gateway.
 *
 * SKIP SEMANTICS
 * --------------
 * The constructor accepts `skipMetadataKeys` — a list of Reflector metadata
 * keys that indicate "skip tenant injection for this route".  Pass whichever
 * decorator key your service uses:
 *   - SKIP_TENANT_KEY  (from @SkipTenant() — assessment, learn)
 *   - 'isPublic'       (from @Public() — payment)
 * Any truthy value for any of those keys causes the interceptor to forward
 * the request without resolving or injecting a buId.
 *
 * PRE-BACKFILL SAFETY
 * -------------------
 * If the resolver returns undefined (e.g. bu_id not yet backfilled), the
 * interceptor logs a WARN and forwards the request WITHOUT injecting ALS
 * context (isolation is inactive).  This prevents bricking the service before
 * the backfill migration runs.  Set `failOnMissingBu: true` in opts to get a
 * 403 instead (use for internal-service routes where the bu is always required).
 */

import {
  type CallHandler,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
  type NestInterceptor,
} from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { Observable } from 'rxjs';
import type { BuResolver } from './bu-resolver.interface';
import { SKIP_TENANT_KEY } from './skip-tenant.decorator';
import { runWithTenant, type Scope } from './tenant-context';

/** RFC 4122 UUID (case-insensitive). */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface BaseTenantInterceptorOptions {
  /**
   * When true, a missing (undefined) server buId is treated as a hard error
   * (ForbiddenException) rather than a skip-with-log.
   *
   * Use for internal-service routes where the BU is always required and the
   * pre-backfill soft-fail safety is not needed.
   *
   * @default false
   */
  failOnMissingBu?: boolean;
}

/**
 * BaseTenantInterceptor — pluggable, hardened per-request BU tenant context.
 *
 * Consumers extend this class and inject their service-specific BuResolver:
 *
 * @example
 * \@Injectable()
 * export class TenantInterceptor extends BaseTenantInterceptor {
 *   constructor(reflector: Reflector, resolver: WorkspaceBuResolver) {
 *     super(reflector, resolver, [SKIP_TENANT_KEY]);
 *   }
 * }
 */
@Injectable()
export class BaseTenantInterceptor implements NestInterceptor {
  protected readonly logger = new Logger(BaseTenantInterceptor.name);

  constructor(
    protected readonly reflector: Reflector,
    protected readonly resolver: BuResolver,
    protected readonly skipMetadataKeys: string[] = [SKIP_TENANT_KEY],
    protected readonly opts: BaseTenantInterceptorOptions = {},
  ) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    // Check skip metadata from any of the configured keys.
    // Handler-level metadata overrides class-level (getAllAndOverride semantics).
    const skip = this.skipMetadataKeys.some((key) =>
      this.reflector.getAllAndOverride<boolean>(key, [context.getHandler(), context.getClass()]),
    );
    if (skip) return next.handle();

    const req = context.switchToHttp().getRequest<Request>();

    // Resolve the server-authoritative BU UUID.
    const serverBuId = await this.resolver.resolveServerBuId(req);

    // Centralised header cross-check — this is the code that was copy-pasted
    // and got wrong three times.  It lives here ONCE.
    const buId = this._validateHeaderAndGetBuId(req, serverBuId);

    if (!buId) {
      if (this.opts.failOnMissingBu) {
        throw new ForbiddenException(
          'BU context is required for this route but could not be resolved. ' +
            'Ensure the request carries the correct BU headers and the resolver ' +
            'is configured correctly.',
        );
      }
      // Pre-backfill safety: log and continue without RLS isolation.
      this.logger.warn(
        '[BaseTenantInterceptor] No server-derived buId resolved — ' +
          'RLS isolation is inactive for this request. ' +
          'Ensure the upstream guard has populated the request and the ' +
          'backfill migration has run.',
      );
      return next.handle();
    }

    const scopes: Scope[] = [{ kind: 'bu', value: buId }];

    return new Observable((subscriber) => {
      runWithTenant({ buId: buId!, scopes }, () => {
        next.handle().subscribe({
          next: (val) => subscriber.next(val),
          error: (err) => subscriber.error(err),
          complete: () => subscriber.complete(),
        });
      });
    });
  }

  /**
   * THE CENTRALISED HEADER CROSS-CHECK.
   *
   * This private method is the single source of truth for the security rule:
   * "the x-business-bu-id header is a consistency check, not an authority
   * source."
   *
   * Rules (in order):
   *   1. serverBuId is AUTHORITATIVE — always derived from the guard/DB.
   *   2. If header is present and serverBuId is known:
   *        - Header must be a valid UUID (else: warn and ignore, use serverBuId).
   *        - Header must equal serverBuId case-insensitively (else: 403).
   *        - On match: return serverBuId (NOT the header value).
   *   3. If header is present but serverBuId is unknown:
   *        - Header is IGNORED — cannot validate without a server value.
   *        - Return undefined (no BU context).
   *   4. If header is absent: return serverBuId directly (may be undefined).
   *
   * The header value is NEVER returned without a server value confirming it.
   *
   * Visibility is `_` to allow white-box unit testing from specs in the same
   * package while keeping it out of the public API surface.
   */
  _validateHeaderAndGetBuId(req: Request, serverBuId: string | undefined): string | undefined {
    const rawHeader = req.headers['x-business-bu-id'];
    const headerBuId = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;

    if (!headerBuId) {
      // No header — use server value directly (may be undefined).
      return serverBuId;
    }

    // Header is present.
    if (!serverBuId) {
      // Cannot validate the header without a server-side value.
      // Silently ignore — returning undefined triggers skip-with-log above.
      this.logger.warn(
        '[BaseTenantInterceptor] x-business-bu-id header present but no ' +
          'server-derived buId to validate against — header ignored.',
      );
      return undefined;
    }

    if (!UUID_RE.test(headerBuId)) {
      // Malformed header — treat as absent and use serverBuId.
      this.logger.warn('[BaseTenantInterceptor] x-business-bu-id header is not UUID-shaped — ignored.');
      return serverBuId;
    }

    if (headerBuId.toLowerCase() !== serverBuId.toLowerCase()) {
      // Mismatch — possible misconfiguration or cross-BU injection attempt.
      this.logger.error(
        `[BaseTenantInterceptor] Header buId (${headerBuId}) does not match ` +
          `server-derived buId (${serverBuId}). Request rejected with 403.`,
      );
      throw new ForbiddenException(
        'x-business-bu-id header does not match the server-derived BU. ' +
          'Possible misconfiguration or cross-BU injection attempt.',
      );
    }

    // Header matches — return the server-derived value (same UUID, canonical form).
    return serverBuId;
  }
}
