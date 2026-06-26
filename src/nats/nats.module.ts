import {
  DynamicModule,
  Global,
  Inject,
  Logger,
  Module,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import {
  AckPolicy,
  DeliverPolicy,
  JetStreamClient,
  JetStreamManager,
  NatsConnection,
  ReplayPolicy,
  RetentionPolicy,
  StorageType,
  StringCodec,
  connect,
  nanos,
} from 'nats';

// ---------------------------------------------------------------------------
// Injection tokens
// ---------------------------------------------------------------------------

export const NATS_CONNECTION = 'NATS_CONNECTION';
export const NATS_JETSTREAM = 'NATS_JETSTREAM';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SubscribeDurableOptions {
  /** JetStream stream name (must exist or will be created) */
  stream: string;
  /** NATS subject to subscribe on (must be within the stream's subjects) */
  subject: string;
  /** Durable consumer name (survives reconnects) */
  durable: string;
  /** Message handler; throw to trigger nak / redelivery */
  handler: (data: unknown, subject: string) => Promise<void>;
  /** Max delivery attempts before the message is terminated and sent to DLQ. Default: 5 */
  maxDeliver?: number;
  /** Ack wait in milliseconds. Default: 30_000 */
  ackWait?: number;
  /** Backoff delays in milliseconds between redeliveries */
  backoff?: number[];
}

// ---------------------------------------------------------------------------
// NatsService
// ---------------------------------------------------------------------------

/**
 * NatsService wraps the NATS JetStream client for publish/subscribe.
 *
 * Inject this service wherever you need to publish or subscribe to JetStream
 * subjects. It is provided by NatsModule (global, singleton).
 */
export class NatsService implements OnApplicationShutdown {
  private readonly logger = new Logger(NatsService.name);
  private readonly sc = StringCodec();

  constructor(
    private readonly nc: NatsConnection,
    private readonly js: JetStreamClient,
    private readonly jsm: JetStreamManager,
  ) {}

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Publish a message to a JetStream subject.
   * @param subject - The NATS subject (must be bound to a stream).
   * @param data - Payload; will be JSON-serialised.
   */
  async publish(subject: string, data: unknown): Promise<void> {
    const encoded = this.sc.encode(JSON.stringify(data));
    await this.js.publish(subject, encoded);
  }

  /**
   * Subscribe to a JetStream subject with a durable push consumer.
   *
   * On each message:
   * - handler resolves → `ack()` (at-most-once processing window)
   * - handler throws → `nak()` (JetStream redelivers per backoff config)
   * - delivery count reaches `maxDeliver` → `term()` + publish to `${subject}.dlq`
   *
   * The DLQ subject (`${subject}.dlq`) is ensured to be captured by a
   * retained DLQ stream (created lazily on first terminal failure).
   */
  async subscribeDurable(opts: SubscribeDurableOptions): Promise<void> {
    const {
      stream,
      subject,
      durable,
      handler,
      maxDeliver = 5,
      ackWait = 30_000,
      backoff = [],
    } = opts;

    // Ensure the stream exists (idempotent upsert)
    await this.ensureStream(stream, [subject]);

    const consumerConfig: Parameters<JetStreamManager['consumers']['add']>[1] = {
      durable_name: durable,
      ack_policy: AckPolicy.Explicit,
      deliver_policy: DeliverPolicy.All,
      replay_policy: ReplayPolicy.Instant,
      max_deliver: maxDeliver,
      ack_wait: nanos(ackWait),
      ...(backoff.length > 0 ? { backoff: backoff.map(nanos) } : {}),
      filter_subject: subject,
    };

    await this.jsm.consumers.add(stream, consumerConfig).catch((err: Error) => {
      // 400 = consumer already exists — fine, we'll just re-use it
      if (!err.message?.includes('consumer name already in use')) {
        throw err;
      }
    });

    const consumer = await this.js.consumers.get(stream, durable);
    const sub = await consumer.consume();

    (async () => {
      for await (const msg of sub) {
        const deliveryCount = msg.info?.redeliveryCount ?? 1;
        const isTerminal = deliveryCount >= maxDeliver;

        try {
          const raw = this.sc.decode(msg.data);
          const data = JSON.parse(raw);
          await handler(data, msg.subject);
          msg.ack();
        } catch (err) {
          if (isTerminal) {
            this.logger.error(
              `Message on ${msg.subject} failed after ${deliveryCount} deliveries — terminating and routing to DLQ`,
              err,
            );
            msg.term();
            await this.routeToDlq(msg.subject, msg.data).catch((dlqErr) => {
              this.logger.error(`Failed to route message to DLQ for ${msg.subject}`, dlqErr);
            });
          } else {
            this.logger.warn(
              `Handler failed for ${msg.subject} (delivery ${deliveryCount}/${maxDeliver}) — nak for redelivery`,
              err,
            );
            msg.nak();
          }
        }
      }
    })().catch((err) => {
      this.logger.error(`JetStream consumer loop crashed for ${stream}/${durable}`, err);
    });
  }

  // -------------------------------------------------------------------------
  // DLQ routing
  // -------------------------------------------------------------------------

  /** Ensures the DLQ stream exists and publishes the raw message bytes there. */
  async routeToDlq(originalSubject: string, rawData: Uint8Array): Promise<void> {
    const dlqSubject = `${originalSubject}.dlq`;
    await this.ensureDlqStream(dlqSubject);
    await this.js.publish(dlqSubject, rawData);
  }

  // -------------------------------------------------------------------------
  // Stream management
  // -------------------------------------------------------------------------

  private async ensureStream(name: string, subjects: string[]): Promise<void> {
    try {
      const info = await this.jsm.streams.info(name);
      // Add any new subjects the stream doesn't cover yet
      const existing = info.config.subjects ?? [];
      const missing = subjects.filter((s) => !existing.includes(s));
      if (missing.length > 0) {
        await this.jsm.streams.update(name, {
          ...info.config,
          subjects: [...existing, ...missing],
        });
      }
    } catch {
      // Stream does not exist — create it
      await this.jsm.streams.add({
        name,
        subjects,
        storage: StorageType.File,
        retention: RetentionPolicy.Limits,
        num_replicas: 1,
      });
    }
  }

  private async ensureDlqStream(dlqSubject: string): Promise<void> {
    const dlqStream = 'DLQ';
    try {
      const info = await this.jsm.streams.info(dlqStream);
      const existing = info.config.subjects ?? [];
      if (!existing.includes(dlqSubject) && !existing.includes('*.dlq')) {
        await this.jsm.streams.update(dlqStream, {
          ...info.config,
          subjects: [...existing, dlqSubject],
        });
      }
    } catch {
      // Create DLQ stream capturing all *.dlq subjects
      await this.jsm.streams.add({
        name: dlqStream,
        subjects: ['*.dlq', '*.*.dlq'],
        storage: StorageType.File,
        retention: RetentionPolicy.Limits,
        num_replicas: 1,
      });
    }
  }

  // -------------------------------------------------------------------------
  // Shutdown
  // -------------------------------------------------------------------------

  async onApplicationShutdown(): Promise<void> {
    if (!this.nc.isClosed()) {
      await this.nc.drain();
    }
  }
}

// ---------------------------------------------------------------------------
// NatsModule
// ---------------------------------------------------------------------------

/**
 * NatsModule provides a singleton NatsService connected to NATS JetStream.
 *
 * Configuration via env:
 * - `NATS_URL` — NATS server URL (default: `nats://localhost:4222`)
 *
 * Usage:
 * ```ts
 * @Module({ imports: [NatsModule] })
 * export class AppModule {}
 * ```
 *
 * Then inject:
 * ```ts
 * constructor(private readonly nats: NatsService) {}
 * ```
 */
@Global()
@Module({})
export class NatsModule implements OnApplicationBootstrap {
  private static nc: NatsConnection;
  private static js: JetStreamClient;
  private static jsm: JetStreamManager;

  private readonly logger = new Logger(NatsModule.name);

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  constructor(@Inject(NATS_CONNECTION) private readonly conn: unknown) {}

  static forRoot(): DynamicModule {
    const connectionProvider = {
      provide: NATS_CONNECTION,
      useFactory: async (): Promise<NatsConnection> => {
        const url = process.env['NATS_URL'] ?? 'nats://localhost:4222';
        const nc = await connect({ servers: url });
        NatsModule.nc = nc;
        NatsModule.js = nc.jetstream();
        NatsModule.jsm = await nc.jetstreamManager();
        return nc;
      },
    };

    const jetstreamProvider = {
      provide: NATS_JETSTREAM,
      useFactory: (): JetStreamClient => NatsModule.js,
      inject: [NATS_CONNECTION],
    };

    const serviceProvider = {
      provide: NatsService,
      useFactory: (): NatsService =>
        new NatsService(NatsModule.nc, NatsModule.js, NatsModule.jsm),
      inject: [NATS_CONNECTION],
    };

    return {
      module: NatsModule,
      providers: [connectionProvider, jetstreamProvider, serviceProvider],
      exports: [NatsService, NATS_CONNECTION, NATS_JETSTREAM],
    };
  }

  async onApplicationBootstrap(): Promise<void> {
    this.logger.log(`Connected to NATS at ${process.env['NATS_URL'] ?? 'nats://localhost:4222'}`);
  }
}
