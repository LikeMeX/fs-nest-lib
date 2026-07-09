import { SetMetadata } from '@nestjs/common';

/**
 * SKIP_TENANT_KEY — Reflector metadata key consumed by BaseTenantInterceptor.
 *
 * When a route handler or controller class is decorated with @SkipTenant(),
 * the interceptor bypasses BU context resolution and forwards the request
 * directly, without calling requireBu() or runWithTenant().
 *
 * This is intentional for routes that serve users who have no BU / workspace:
 *   - B2C listing routes
 *   - Public endpoints that do not touch tenant-scoped repos
 *
 * WARNING: A skipped route MUST NOT call any repo method wrapped with
 * withTenantTx — those methods call requireBu() which will throw.  If a
 * route needs partial BU isolation, do NOT use @SkipTenant(); instead
 * restructure the usecase to use a non-RLS path.
 */
export const SKIP_TENANT_KEY = 'skipTenant' as const;

/**
 * Mark a route handler (or controller class) so BaseTenantInterceptor will
 * skip BU context wiring for it.
 *
 * Apply at the method level — handler-level metadata takes precedence over
 * class-level metadata (@UseInterceptors).
 *
 * @example
 * \@SkipTenant()
 * \@Get('b2c')
 * async getListB2C() { ... }
 */
export const SkipTenant = (): MethodDecorator & ClassDecorator =>
  SetMetadata(SKIP_TENANT_KEY, true);
