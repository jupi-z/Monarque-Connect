import type { ClaimedOutboxEvent } from './outbox.repository.js';

export interface EventWorkerObserver {
  recordProcessed(event: ClaimedOutboxEvent, durationMs: number, consumers: string[]): void;
  recordRetry(event: ClaimedOutboxEvent, durationMs: number): void;
  recordFailed(event: ClaimedOutboxEvent, durationMs: number): void;
}

export interface EventWorkerMetricsSnapshot {
  processed: number;
  retried: number;
  failed: number;
  processingDurationMs: { count: number; total: number; max: number };
  byEventType: Record<string, {
    processed: number;
    retried: number;
    failed: number;
    consumers: string[];
  }>;
}

export class EventWorkerMetrics implements EventWorkerObserver {
  private processed = 0;
  private retried = 0;
  private failed = 0;
  private durationCount = 0;
  private durationTotal = 0;
  private durationMax = 0;
  private readonly byEventType = new Map<string, EventWorkerMetricsSnapshot['byEventType'][string]>();

  recordProcessed(event: ClaimedOutboxEvent, durationMs: number, consumers: string[]): void {
    this.processed += 1;
    this.recordDuration(durationMs);
    const item = this.item(event);
    item.processed += 1;
    item.consumers = [...new Set([...item.consumers, ...consumers])].sort();
  }

  recordRetry(event: ClaimedOutboxEvent, durationMs: number): void {
    this.retried += 1;
    this.recordDuration(durationMs);
    this.item(event).retried += 1;
  }

  recordFailed(event: ClaimedOutboxEvent, durationMs: number): void {
    this.failed += 1;
    this.recordDuration(durationMs);
    this.item(event).failed += 1;
  }

  snapshot(): EventWorkerMetricsSnapshot {
    return {
      processed: this.processed,
      retried: this.retried,
      failed: this.failed,
      processingDurationMs: { count: this.durationCount, total: this.durationTotal, max: this.durationMax },
      byEventType: Object.fromEntries([...this.byEventType].map(([key, value]) => [key, { ...value, consumers: [...value.consumers] }])),
    };
  }

  private item(event: ClaimedOutboxEvent) {
    const key = `${event.eventType}:v${event.eventVersion}`;
    const existing = this.byEventType.get(key);
    if (existing) return existing;
    const created = { processed: 0, retried: 0, failed: 0, consumers: [] as string[] };
    this.byEventType.set(key, created);
    return created;
  }

  private recordDuration(durationMs: number): void {
    this.durationCount += 1;
    this.durationTotal += durationMs;
    this.durationMax = Math.max(this.durationMax, durationMs);
  }
}

export class JsonEventWorkerObserver implements EventWorkerObserver {
  recordProcessed(event: ClaimedOutboxEvent, durationMs: number, consumers: string[]): void {
    this.write('processed', event, durationMs, consumers);
  }

  recordRetry(event: ClaimedOutboxEvent, durationMs: number): void {
    this.write('retry', event, durationMs);
  }

  recordFailed(event: ClaimedOutboxEvent, durationMs: number): void {
    this.write('failed', event, durationMs);
  }

  private write(result: string, event: ClaimedOutboxEvent, durationMs: number, consumers: string[] = []): void {
    console.log(JSON.stringify({
      eventId: event.id,
      eventType: event.eventType,
      eventVersion: event.eventVersion,
      correlationId: event.correlationId,
      organizationId: event.organizationId,
      attempt: event.attempts,
      result,
      durationMs,
      consumers,
    }));
  }
}
