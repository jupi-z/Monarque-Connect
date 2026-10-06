import type { Pool } from 'pg';
import { sanitizeError } from './domain-event.factory.js';
import { EventDispatcher } from './event-dispatcher.js';
import { nextRetryAt } from './retry-policy.js';
import { OutboxRepository } from './outbox.repository.js';

export interface WorkerProcessOptions {
  batchSize?: number;
  leaseSeconds?: number;
  maxAttempts?: number;
  now?: Date;
  workerId?: string;
}

export class EventWorker {
  constructor(
    private readonly pool: Pool,
    private readonly repository: OutboxRepository,
    private readonly dispatcher: EventDispatcher,
  ) {}

  async processBatch(options: WorkerProcessOptions = {}): Promise<number> {
    const workerId = options.workerId ?? `event-worker-${process.pid}`;
    const batchSize = options.batchSize ?? 50;
    const leaseSeconds = options.leaseSeconds ?? 60;
    const maxAttempts = options.maxAttempts ?? 8;
    const claimClient = await this.pool.connect();
    let claimed;
    try {
      await claimClient.query('BEGIN');
      claimed = await this.repository.claimBatch(claimClient, { workerId, batchSize, leaseSeconds });
      await claimClient.query('COMMIT');
    } catch (error) {
      await claimClient.query('ROLLBACK');
      throw error;
    } finally {
      claimClient.release();
    }

    for (const event of claimed) {
      await this.processOne(event, maxAttempts, options.now ?? new Date());
    }
    return claimed.length;
  }

  private async processOne(event: Awaited<ReturnType<OutboxRepository['claimBatch']>>[number], maxAttempts: number, now: Date): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await this.dispatcher.dispatch(client, event);
      await this.repository.markProcessed(client, event.id);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      const failureClient = await this.pool.connect();
      try {
        await failureClient.query('BEGIN');
        const safeError = sanitizeError(error);
        if (event.attempts >= maxAttempts) {
          await this.repository.markFailed(failureClient, event.id, safeError);
        } else {
          await this.repository.markRetry(failureClient, event.id, nextRetryAt(event.attempts, now), safeError);
        }
        await failureClient.query('COMMIT');
      } catch (failureError) {
        await failureClient.query('ROLLBACK');
        throw failureError;
      } finally {
        failureClient.release();
      }
    } finally {
      client.release();
    }
  }
}
