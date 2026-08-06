import {
  Body,
  Controller,
  HttpException,
  HttpStatus,
  Logger,
  NotFoundException,
  Post,
  UseGuards,
} from '@nestjs/common';
import { InternalGuard } from '../internal/internal.guard';
import { type CmdHandlerEntry } from './internal-cmd.decorator';

// ---------------------------------------------------------------------------
// Dispatch registry
// ---------------------------------------------------------------------------

type HandlerFn = (payload: unknown) => Promise<unknown>;

/**
 * InternalRpcDispatcher holds the cmd → handler function map.
 * A singleton used by InternalRpcController to dispatch incoming RPC calls.
 *
 * Register service methods here:
 * ```ts
 * InternalRpcDispatcher.register(courseService, collectCmds(CourseService));
 * ```
 */
export class InternalRpcDispatcher {
  private static readonly registry = new Map<string, HandlerFn>();
  private static readonly logger = new Logger('InternalRpcDispatcher');

  /**
   * Register all @InternalCmd methods from a service instance.
   *
   * @param instance - An instantiated service object.
   * @param entries  - CmdHandlerEntry[] from collectCmds(ServiceClass).
   */
  static register(instance: object, entries: CmdHandlerEntry[]): void {
    for (const entry of entries) {
      if (InternalRpcDispatcher.registry.has(entry.cmd)) {
        InternalRpcDispatcher.logger.warn(
          `Duplicate @InternalCmd registration for '${entry.cmd}' — overwriting previous handler`,
        );
      }
      const method = (instance as Record<string, unknown>)[entry.methodName];
      if (typeof method !== 'function') {
        throw new TypeError(
          `InternalRpcDispatcher: method '${entry.methodName}' not found on ${instance.constructor.name}`,
        );
      }
      InternalRpcDispatcher.registry.set(entry.cmd, method.bind(instance) as HandlerFn);
      InternalRpcDispatcher.logger.log(
        `Registered cmd '${entry.cmd}' → ${instance.constructor.name}.${entry.methodName}`,
      );
    }
  }

  /**
   * Dispatch a cmd to its registered handler.
   *
   * @throws NotFoundException (404) if no handler is registered for the cmd.
   */
  static async dispatch(cmd: string, payload: unknown): Promise<unknown> {
    const handler = InternalRpcDispatcher.registry.get(cmd);
    if (!handler) {
      throw new NotFoundException(`No handler registered for cmd '${cmd}'`);
    }
    return handler(payload);
  }

  /** For testing: reset the registry to a clean state. */
  static _reset(): void {
    InternalRpcDispatcher.registry.clear();
  }
}

// ---------------------------------------------------------------------------
// RPC body shape
// ---------------------------------------------------------------------------

interface RpcBody {
  cmd: string;
  payload: unknown;
}

// ---------------------------------------------------------------------------
// InternalRpcController
// ---------------------------------------------------------------------------

/**
 * InternalRpcController provides the `POST /internal/rpc` tunnel endpoint.
 *
 * This is the mechanical migration surface: every legacy `ClientProxy.send()`
 * call routes here first. As Phase 2 adds deterministic REST routes, callers
 * progressively migrate off the tunnel — but the tunnel remains a durable
 * fallback and can be retired per-cmd.
 *
 * Usage in a service module:
 * ```ts
 * @Module({
 *   controllers: [InternalRpcController],
 * })
 * export class AppModule implements OnModuleInit {
 *   constructor(private readonly svc: CourseService) {}
 *
 *   onModuleInit() {
 *     InternalRpcDispatcher.register(this.svc, collectCmds(CourseService));
 *   }
 * }
 * ```
 *
 * All routes under `/internal/*` are behind InternalGuard.
 */
@Controller('internal')
@UseGuards(InternalGuard)
export class InternalRpcController {
  private readonly logger = new Logger(InternalRpcController.name);

  /**
   * RPC tunnel entry point.
   *
   * Body: `{ cmd: string, payload: unknown }`
   * Returns the handler's result directly as JSON.
   * 404 if no handler registered for the cmd.
   * 400 if cmd is missing in the body.
   */
  @Post('rpc')
  async handleRpc(@Body() body: RpcBody): Promise<unknown> {
    if (!body?.cmd) {
      throw new HttpException('Missing required field: cmd', HttpStatus.BAD_REQUEST);
    }

    this.logger.debug(`RPC dispatch: cmd=${body.cmd}`);
    return InternalRpcDispatcher.dispatch(body.cmd, body.payload);
  }
}
