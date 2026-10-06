import { describe, expect, it } from 'vitest';
import { EventWorkerMetrics } from '../../src/events/event-observability.js';
import type { ClaimedOutboxEvent } from '../../src/events/outbox.repository.js';

describe('EventWorkerMetrics', () => {
  it('records processing outcomes and durations without payloads', () => {
    const metrics = new EventWorkerMetrics();
    const event = { eventType: 'foundation.probe.recorded', eventVersion: 1, correlationId: 'correlation', id: 'event', organizationId: null, attempts: 1 } as ClaimedOutboxEvent;
    metrics.recordProcessed(event, 42, ['foundation-probe-projection']);
    metrics.recordRetry(event, 84);
    metrics.recordFailed(event, 126);

    expect(metrics.snapshot()).toEqual({
      processed: 1,
      retried: 1,
      failed: 1,
      processingDurationMs: { count: 3, total: 252, max: 126 },
      byEventType: {
        'foundation.probe.recorded:v1': {
          processed: 1,
          retried: 1,
          failed: 1,
          consumers: ['foundation-probe-projection'],
        },
      },
    });
  });
});
