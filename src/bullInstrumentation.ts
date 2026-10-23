import {
  type Attributes,
  type Context,
  context,
  propagation,
  ROOT_CONTEXT,
  type Span,
  SpanKind,
  SpanStatusCode,
  trace,
} from '@opentelemetry/api';
import { InstrumentationBase, InstrumentationNodeModuleDefinition } from '@opentelemetry/instrumentation';

/** Job option that carries the W3C trace context from `queue.add()` to the worker; Bull persists opts with the job. */
export const BULL_TRACE_CARRIER_KEY = 'otelContext';

type JobOpts = Record<string, unknown> & { repeat?: unknown };
interface BullJob {
  id?: string | number;
  name?: string;
  opts?: JobOpts;
  attemptsMade?: number;
  failedReason?: string;
}
interface BullQueue {
  name: string;
}
interface BulkJob {
  name?: string;
  data?: unknown;
  opts?: JobOpts;
}
type AnyFn = (...args: any[]) => unknown;
interface BullModule {
  prototype: { add: AnyFn; addBulk: AnyFn; processJob: AnyFn };
}

const attrs = (queue: BullQueue, operation: string, jobName?: string): Attributes => ({
  'messaging.system': 'bull',
  'messaging.destination.name': queue.name,
  'messaging.operation.type': operation,
  ...(jobName ? { 'bull.job.name': jobName } : {}),
});

const carrierFor = (ctx: Context): Record<string, string> => {
  const carrier: Record<string, string> = {};
  propagation.inject(ctx, carrier);
  return carrier;
};

const endWithError = (span: Span, err: unknown): void => {
  span.recordException(err as Error);
  span.setStatus({ code: SpanStatusCode.ERROR, message: (err as Error)?.message });
  span.end();
};

/**
 * No upstream instrumentation exists for Bull v3/v4, so a job ran detached from the request that queued it:
 * its pg spans became orphan root traces and its ioredis spans were dropped (requireParentSpan). This puts a
 * PRODUCER span on add/addBulk, carries its context in the job opts, and runs processJob under a CONSUMER span
 * parented to it, so the job and everything it touches land in the original request's trace.
 */
export class BullInstrumentation extends InstrumentationBase {
  constructor() {
    super('fs-nest-lib-instrumentation-bull', '1.0.0', {});
  }

  protected init() {
    return new InstrumentationNodeModuleDefinition(
      'bull',
      ['>=3 <5'],
      (moduleExports: BullModule) => {
        const proto = moduleExports.prototype;
        this._wrap(proto, 'add', (original: AnyFn) => this.patchAdd(original));
        this._wrap(proto, 'addBulk', (original: AnyFn) => this.patchAddBulk(original));
        this._wrap(proto, 'processJob', (original: AnyFn) => this.patchProcessJob(original));
        return moduleExports;
      },
      (moduleExports: BullModule) => {
        const proto = moduleExports.prototype;
        this._unwrap(proto, 'add');
        this._unwrap(proto, 'addBulk');
        this._unwrap(proto, 'processJob');
      },
    );
  }

  private patchAdd(original: AnyFn): AnyFn {
    const inst = this;
    return function (this: BullQueue, ...args: unknown[]) {
      const named = typeof args[0] === 'string';
      const optsIndex = named ? 2 : 1;
      const opts = (args[optsIndex] as JobOpts | undefined) ?? {};
      // ponytail: repeatable jobs are re-created by the worker forever; skip them rather than pin every run to one request.
      if (opts.repeat) return original.apply(this, args);

      const span = inst.tracer.startSpan(`${this.name} send`, {
        kind: SpanKind.PRODUCER,
        attributes: attrs(this, 'send', named ? (args[0] as string) : undefined),
      });
      const ctx = trace.setSpan(context.active(), span);
      args[optsIndex] = { ...opts, [BULL_TRACE_CARRIER_KEY]: carrierFor(ctx) };
      return (context.with(ctx, () => original.apply(this, args)) as Promise<BullJob>).then(
        (job) => {
          if (job?.id !== undefined) span.setAttribute('messaging.message.id', String(job.id));
          span.end();
          return job;
        },
        (err) => {
          endWithError(span, err);
          throw err;
        },
      );
    };
  }

  private patchAddBulk(original: AnyFn): AnyFn {
    const inst = this;
    return function (this: BullQueue, jobs: BulkJob[]) {
      const span = inst.tracer.startSpan(`${this.name} send`, {
        kind: SpanKind.PRODUCER,
        attributes: { ...attrs(this, 'send'), 'messaging.batch.message_count': jobs.length },
      });
      const ctx = trace.setSpan(context.active(), span);
      const carrier = carrierFor(ctx);
      const traced = jobs.map((job) => ({ ...job, opts: { ...job.opts, [BULL_TRACE_CARRIER_KEY]: carrier } }));
      return (context.with(ctx, () => original.call(this, traced)) as Promise<unknown>).then(
        (res) => {
          span.end();
          return res;
        },
        (err) => {
          endWithError(span, err);
          throw err;
        },
      );
    };
  }

  private patchProcessJob(original: AnyFn): AnyFn {
    const inst = this;
    return function (this: BullQueue, job: BullJob | undefined, ...rest: unknown[]) {
      if (!job) return original.call(this, job, ...rest);

      // ROOT, not active: the fetch loop's leftover context is not this job's parent.
      const carrier = (job.opts?.[BULL_TRACE_CARRIER_KEY] as Record<string, string> | undefined) ?? {};
      const parent = propagation.extract(ROOT_CONTEXT, carrier);
      const span = inst.tracer.startSpan(
        `${this.name} process`,
        {
          kind: SpanKind.CONSUMER,
          attributes: {
            ...attrs(this, 'process', job.name),
            ...(job.id !== undefined ? { 'messaging.message.id': String(job.id) } : {}),
          },
        },
        parent,
      );
      const attemptsBefore = job.attemptsMade ?? 0;
      return (
        context.with(trace.setSpan(parent, span), () => original.call(this, job, ...rest)) as Promise<unknown>
      ).then(
        (res) => {
          // processJob swallows handler errors and moves the job to failed, which bumps attemptsMade.
          if ((job.attemptsMade ?? 0) > attemptsBefore) {
            span.setStatus({ code: SpanStatusCode.ERROR, message: job.failedReason });
          }
          span.end();
          return res;
        },
        (err) => {
          endWithError(span, err);
          throw err;
        },
      );
    };
  }
}
