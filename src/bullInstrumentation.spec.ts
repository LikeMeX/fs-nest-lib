import { SpanKind, SpanStatusCode, trace } from '@opentelemetry/api';
import { node, tracing } from '@opentelemetry/sdk-node';

import { BULL_TRACE_CARRIER_KEY, BullInstrumentation } from './bullInstrumentation';

type Job = { id: string; name: string; opts: Record<string, unknown>; attemptsMade: number; failedReason?: string };

/** Stand-in for bull's Queue: same method shapes, and processJob swallows handler errors like the real one. */
class FakeQueue {
  name = 'courses-queue';
  jobs: Job[] = [];
  handler: (job: Job) => void = () => {};

  add(name: string | unknown, data?: unknown, opts?: Record<string, unknown>) {
    const o = typeof name === 'string' ? opts : (data as Record<string, unknown>);
    const job = {
      id: String(this.jobs.length + 1),
      name: typeof name === 'string' ? name : '__default__',
      opts: { ...o },
      attemptsMade: 0,
    };
    this.jobs.push(job);
    return Promise.resolve(job);
  }

  addBulk(jobs: { name: string; opts?: Record<string, unknown> }[]) {
    return Promise.all(jobs.map((j) => this.add(j.name, {}, j.opts)));
  }

  processJob(job: Job) {
    try {
      this.handler(job);
    } catch (err) {
      job.attemptsMade++;
      job.failedReason = (err as Error).message;
    }
    return Promise.resolve();
  }
}

describe('BullInstrumentation', () => {
  const exporter = new tracing.InMemorySpanExporter();
  const provider = new node.NodeTracerProvider({ spanProcessors: [new tracing.SimpleSpanProcessor(exporter)] });
  provider.register();
  const instrumentation = new BullInstrumentation();
  instrumentation.disable();
  instrumentation.setTracerProvider(provider);
  instrumentation.getModuleDefinitions()[0].patch?.(FakeQueue);
  const tracer = provider.getTracer('test');

  beforeEach(() => exporter.reset());

  const named = (name: string) => exporter.getFinishedSpans().find((s) => s.name === name);

  it('runs the job, and what it touches, inside the trace of the request that queued it', async () => {
    const queue = new FakeQueue();
    queue.handler = () => tracer.startSpan('pg.query').end();

    await tracer.startActiveSpan('POST /courses', async (request) => {
      await queue.add('waiting-list', { courseId: 1 }, { attempts: 3 });
      request.end();
    });
    await queue.processJob(queue.jobs[0]);

    const request = named('POST /courses');
    const send = named('courses-queue send');
    const process = named('courses-queue process');
    const query = named('pg.query');
    const traceId = request?.spanContext().traceId;
    expect([send, process, query].map((s) => s?.spanContext().traceId)).toEqual([traceId, traceId, traceId]);
    expect(send?.kind).toBe(SpanKind.PRODUCER);
    expect(send?.parentSpanContext?.spanId).toBe(request?.spanContext().spanId);
    expect(process?.kind).toBe(SpanKind.CONSUMER);
    expect(process?.parentSpanContext?.spanId).toBe(send?.spanContext().spanId);
    expect(query?.parentSpanContext?.spanId).toBe(process?.spanContext().spanId);
    expect(queue.jobs[0].opts.attempts).toBe(3);
  });

  it('marks the process span as failed when the handler throws', async () => {
    const queue = new FakeQueue();
    queue.handler = () => {
      throw new Error('boom');
    };
    await queue.add('x', {});
    await queue.processJob(queue.jobs[0]);

    expect(named('courses-queue process')?.status).toEqual({ code: SpanStatusCode.ERROR, message: 'boom' });
  });

  it('carries context through addBulk', async () => {
    const queue = new FakeQueue();
    await tracer.startActiveSpan('req', async (request) => {
      await queue.addBulk([{ name: 'a' }, { name: 'b' }]);
      request.end();
    });
    await queue.processJob(queue.jobs[1]);

    expect(named('courses-queue process')?.spanContext().traceId).toBe(named('req')?.spanContext().traceId);
  });

  it('leaves repeatable jobs untouched', async () => {
    const queue = new FakeQueue();
    await queue.add('cron', {}, { repeat: { cron: '* * * * *' } });

    expect(queue.jobs[0].opts[BULL_TRACE_CARRIER_KEY]).toBeUndefined();
    expect(exporter.getFinishedSpans()).toHaveLength(0);
  });

  it('starts a fresh trace for a job queued outside any request', async () => {
    const queue = new FakeQueue();
    await queue.add('orphan', {});
    await tracer.startActiveSpan('unrelated-fetch-loop', async (loop) => {
      await queue.processJob(queue.jobs[0]);
      loop.end();
    });

    const process = named('courses-queue process');
    expect(process?.parentSpanContext?.spanId).toBe(named('courses-queue send')?.spanContext().spanId);
    expect(trace.getActiveSpan()).toBeUndefined();
  });
});
