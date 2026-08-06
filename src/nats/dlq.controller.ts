import { Controller, Get, HttpCode, Inject, Logger, Param, Post, UseGuards } from '@nestjs/common';
import type { JetStreamClient, JetStreamManager, NatsConnection } from 'nats';
import { StringCodec } from 'nats';
import { InternalGuard } from '../internal/internal.guard';
import { NATS_CONNECTION, NATS_JETSTREAM } from './nats.module';

export interface DlqMessage {
  seq: number;
  subject: string;
  data: unknown;
  deliveredAt: string;
}

/**
 * DlqController mixin: mount on any service that has NATS consumers.
 *
 * Provides:
 * - `GET  /internal/dlq`          — list messages in the DLQ stream
 * - `POST /internal/dlq/:seq/replay` — republish a DLQ message back to its
 *   original subject (strips the `.dlq` suffix) and removes it from the DLQ.
 *
 * Both endpoints are protected by InternalGuard (x-internal-token).
 *
 * To mount in a service, import NatsModule.forRoot() and add DlqController
 * to the module's controllers array.
 */
@Controller('internal/dlq')
@UseGuards(InternalGuard)
export class DlqController {
  private readonly logger = new Logger(DlqController.name);
  private readonly sc = StringCodec();
  private readonly nc: NatsConnection;
  private readonly js: JetStreamClient;

  constructor(@Inject(NATS_CONNECTION) nc: unknown, @Inject(NATS_JETSTREAM) js: unknown) {
    this.nc = nc as NatsConnection;
    this.js = js as JetStreamClient;
  }

  /**
   * List up to 100 unprocessed messages currently in the DLQ stream.
   * Returns their sequence number, original subject, and decoded payload.
   */
  @Get()
  async listDlq(): Promise<{ messages: DlqMessage[] }> {
    const jsm: JetStreamManager = await this.nc.jetstreamManager();
    const messages: DlqMessage[] = [];

    try {
      const stream = await jsm.streams.info('DLQ');
      const msgCount = stream.state.messages;

      if (msgCount === 0) {
        return { messages: [] };
      }

      // Pull messages from DLQ stream without acking (peek)
      const consumer = await this.js.consumers.get('DLQ', 'dlq-list-reader').catch(async () => {
        await jsm.consumers.add('DLQ', {
          durable_name: 'dlq-list-reader',
          ack_policy: 'explicit' as any,
          deliver_policy: 'all' as any,
          replay_policy: 'instant' as any,
          max_deliver: 1,
        });
        return this.js.consumers.get('DLQ', 'dlq-list-reader');
      });

      const iter = await consumer.fetch({ max_messages: 100, expires: 2000 });
      for await (const msg of iter) {
        try {
          const raw = this.sc.decode(msg.data);
          const data = JSON.parse(raw);
          messages.push({
            seq: msg.seq,
            subject: msg.subject,
            data,
            deliveredAt: new Date().toISOString(),
          });
        } catch {
          messages.push({
            seq: msg.seq,
            subject: msg.subject,
            data: '<binary>',
            deliveredAt: new Date().toISOString(),
          });
        }
        msg.nak(); // nack so it stays in the DLQ
      }
    } catch (err) {
      this.logger.warn('DLQ stream does not exist or is empty', err);
    }

    return { messages };
  }

  /**
   * Replay a DLQ message: republish its payload to the original subject
   * (derived by stripping the `.dlq` suffix) and delete the DLQ entry.
   *
   * @param seq - Sequence number from the DLQ stream (returned by GET /internal/dlq).
   */
  @Post(':seq/replay')
  @HttpCode(200)
  async replayDlqMessage(@Param('seq') seqStr: string): Promise<{ ok: boolean; republishedTo: string }> {
    const seq = parseInt(seqStr, 10);
    if (Number.isNaN(seq) || seq < 1) {
      throw new Error(`Invalid sequence number: ${seqStr}`);
    }

    const jsm: JetStreamManager = await this.nc.jetstreamManager();

    // Fetch the specific message by seq
    const msg = await jsm.streams.getMessage('DLQ', { seq });
    if (!msg) {
      throw new Error(`No DLQ message with seq=${seq}`);
    }

    // Strip .dlq suffix to find original subject
    const dlqSubject = msg.subject;
    const originalSubject = dlqSubject.replace(/\.dlq$/, '');

    // Republish to original subject
    await this.js.publish(originalSubject, msg.data);
    this.logger.log(`Replayed DLQ seq=${seq} from ${dlqSubject} → ${originalSubject}`);

    // Purge just this sequence from the DLQ stream (delete the specific message)
    await jsm.streams.purge('DLQ', { seq: seq + 1, keep: 0 }).catch((err) => {
      this.logger.warn(`Could not purge DLQ seq=${seq} after replay`, err);
    });

    return { ok: true, republishedTo: originalSubject };
  }
}
