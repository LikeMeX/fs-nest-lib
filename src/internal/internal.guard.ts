import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';

/**
 * InternalGuard validates that inter-service HTTP requests carry the shared
 * INTERNAL_TOKEN header (`x-internal-token`).
 *
 * Usage: apply with `@UseGuards(InternalGuard)` on `/internal/*` controllers
 * or globally on the InternalRpcController.
 *
 * Environment: INTERNAL_TOKEN must be set in all services. If missing at
 * startup the guard logs a warning — it will reject every request until the
 * env var is present, acting as a fail-safe rather than silently allowing
 * all traffic.
 */
@Injectable()
export class InternalGuard implements CanActivate {
  private readonly logger = new Logger(InternalGuard.name);

  canActivate(context: ExecutionContext): boolean {
    const token = process.env['INTERNAL_TOKEN'];
    if (!token) {
      this.logger.warn(
        'INTERNAL_TOKEN env var is not set — all /internal/* requests will be rejected',
      );
      throw new UnauthorizedException('INTERNAL_TOKEN not configured');
    }

    const request = context.switchToHttp().getRequest<{ headers: Record<string, string | undefined> }>();
    const incoming = request.headers['x-internal-token'];

    if (!incoming || incoming !== token) {
      throw new UnauthorizedException('Invalid or missing x-internal-token');
    }

    return true;
  }
}
