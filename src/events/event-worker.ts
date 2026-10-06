import type { Pool } from 'pg';
import { sanitizeError } from './domain-event.factory.js';
import { EventDispatcher } from './event-dispatcher.js';
import { runWithEventContext, workerContextFor } from './event-context.js';
import { nextRetryAt } from './retry-policy.js';
import { OutboxRepository } from './outbox.repository.js';
import { EventWorkerMetrics, type EventWorkerObserver } from './event-observability.js';

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
    private readonly observer: EventWorkerObserver = new EventWorkerMetrics(),
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
      claimed = await this.repository.claimBatch(claimClient, { workerId, batchSize, leaseSeconds, maxAttempts });
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
    const startedAt = Date.now();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const consumers = await runWithEventContext(workerContextFor({
        eventId: event.id,
        correlationId: event.correlationId,
        ...(event.requestId ? { requestId: event.requestId } : {}),
      }), () => this.dispatcher.dispatch(client, event));
      await this.repository.markProcessed(client, event.id, event.claimToken);
      await client.query('COMMIT');
      this.observer.recordProcessed(event, Date.now() - startedAt, consumers);
    } catch (error) {
      await client.query('ROLLBACK');
      try {
        await client.query('BEGIN');
        const safeError = sanitizeError(error);
        if (error instanceof Error && error.name === 'PermanentEventError') {
          await this.repository.markFailed(client, event.id, event.claimToken, safeError);
          this.observer.recordFailed(event, Date.now() - startedAt);
        } else if (event.attempts >= maxAttempts) {
          await this.repository.markFailed(client, event.id, event.claimToken, safeError);
          this.observer.recordFailed(event, Date.now() - startedAt);
        } else {
          await this.repository.markRetry(client, event.id, event.claimToken, nextRetryAt(event.attempts, now), safeError);
          this.observer.recordRetry(event, Date.now() - startedAt);
        }
        await client.query('COMMIT');
      } catch (failureError) {
        await client.query('ROLLBACK');
        throw failureError;
      }
    } finally {
      client.release();
    }
  }
}
