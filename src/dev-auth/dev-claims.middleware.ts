/**
 * DevClaimsMiddleware
 *
 * DEV-ONLY Express/Nest middleware that replicates what KrakenD does in prod:
 * decodes the incoming JWT (no signature verification — only claims are read),
 * and injects the identity headers that downstream services rely on:
 *
 *   x-user             ← JWT claim `id`          (numeric userId)
 *   x-business-member  ← JWT claim `businessMemberId`
 *   x-business         ← JWT claim `businessBuId` (Bu UUID, preferred)
 *                         or `businessId` (numeric fallback for non-learn services)
 *   x-business-role    ← JWT claim `businessRole`
 *
 * Headers are ONLY set when they are absent — existing headers take precedence,
 * so the middleware is safe to compose with other auth flows.
 *
 * GUARD RAILS:
 *   • Only active when `DEV_AUTH_SHIM=1`
 *   • Throws a hard error (not a silent no-op) when `NODE_ENV === 'production'`
 *     to prevent accidental deployment
 */

import { Injectable, Logger, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

/** Shape of a decoded JWT payload we care about for header injection. */
interface DevJwtPayload {
  id?: number;
  businessMemberId?: number;
  /** Bu UUID — preferred over numeric businessId for learn-api RLS */
  businessBuId?: string;
  businessId?: number;
  businessRole?: number;
}

@Injectable()
export class DevClaimsMiddleware implements NestMiddleware {
  private readonly logger = new Logger(DevClaimsMiddleware.name);

  constructor() {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        '[DevClaimsMiddleware] This middleware MUST NOT run in production. ' +
          'NODE_ENV is "production". Remove DevClaimsMiddleware from your app bootstrap.',
      );
    }
    if (process.env.DEV_AUTH_SHIM !== '1') {
      this.logger.warn(
        'DevClaimsMiddleware instantiated but DEV_AUTH_SHIM !== "1" — ' +
          'the middleware will be a no-op.  Set DEV_AUTH_SHIM=1 to activate.',
      );
    }
  }

  use(req: Request, _res: Response, next: NextFunction): void {
    if (process.env.DEV_AUTH_SHIM !== '1') {
      return next();
    }

    try {
      const authHeader = req.headers['authorization'] ?? req.headers['Authorization'];
      if (typeof authHeader !== 'string' || !authHeader.startsWith('Bearer ')) {
        return next();
      }

      const token = authHeader.slice('Bearer '.length);
      const payload = decodeJwtPayload(token);
      if (!payload) return next();

      setIfAbsent(req, 'x-user', payload.id != null ? String(payload.id) : undefined);

      if (payload.businessMemberId != null) {
        setIfAbsent(req, 'x-business-member', String(payload.businessMemberId));
      }

      if (payload.businessRole != null) {
        setIfAbsent(req, 'x-business-role', String(payload.businessRole));
      }

      // x-business: prefer the Bu UUID (for learn-api RLS which does ::uuid cast)
      // fall back to numeric businessId (for credential-api and content-api).
      const businessHeaderValue =
        payload.businessBuId != null
          ? payload.businessBuId
          : payload.businessId != null
            ? String(payload.businessId)
            : undefined;

      if (businessHeaderValue != null) {
        setIfAbsent(req, 'x-business', businessHeaderValue);
      }

      this.logger.debug(
        `[DevClaimsShim] injected headers for user=${payload.id} ` +
          `biz=${businessHeaderValue ?? 'none'} member=${payload.businessMemberId ?? 'none'}`,
      );
    } catch (err) {
      this.logger.warn(`[DevClaimsShim] failed to decode JWT: ${(err as Error).message}`);
    }

    return next();
  }
}

// ---------------------------------------------------------------------------
// Pure helpers (no NestJS dep) so they are unit-testable without DI
// ---------------------------------------------------------------------------

/**
 * Decode the base64url-encoded payload segment of a JWT without verifying the
 * signature.  Returns null when the token is malformed.
 */
export function decodeJwtPayload(token: string): DevJwtPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length < 2) return null;
    const padded = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = Buffer.from(padded, 'base64').toString('utf8');
    return JSON.parse(json) as DevJwtPayload;
  } catch {
    return null;
  }
}

/**
 * Set `req.headers[name]` only when it is absent (undefined / empty string).
 */
export function setIfAbsent(req: Request, name: string, value: string | undefined): void {
  if (value == null) return;
  const existing = req.headers[name];
  if (!existing || existing === '') {
    req.headers[name] = value;
  }
}
