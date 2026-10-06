import { describe, expect, it, vi } from 'vitest';
import { EventDispatcher } from '../../src/events/event-dispatcher.js';
import type { ClaimedOutboxEvent, EventDbClient } from '../../src/events/outbox.repository.js';

const event = {
  id: '0f8fad5b-d9cb-469f-a165-70867728950e',
  eventType: 'foundation.probe.recorded',
  eventVersion: 1,
  organizationId: null,
  establishmentId: null,
  actorType: 'SYSTEM',
  actorId: null,
  aggregateType: 'FoundationProbe',
  aggregateId: '9f8fad5b-d9cb-469f-a165-70867728950e',
  correlationId: '8f8fad5b-d9cb-469f-a165-70867728950e',
  causationId: null,
  requestId: null,
  dataClassification: 'INTERNAL',
  purpose: 'phase-0.5-proof',
  payload: { value: 'probe' },
  status: 'PROCESSING' as const,
  attempts: 1,
  lockedBy: 'worker-a',
  claimToken: '7f8fad5b-d9cb-469f-a165-70867728950e',
  occurredAt: new Date(),
  recordedAt: new Date(),
} satisfies ClaimedOutboxEvent;

describe('EventDispatcher', () => {
  it('dispatches to the handler registered for event type and version', async () => {
    const dispatcher = new EventDispatcher();
    const handler = vi.fn().mockResolvedValue(undefined);
    dispatcher.register('foundation.probe.recorded', 1, handler);

    await dispatcher.dispatch({} as EventDbClient, event);

    expect(handler).toHaveBeenCalledWith({}, event);
  });

  it('rejects unknown event type or version in a controlled way', async () => {
    const dispatcher = new EventDispatcher();

    await expect(dispatcher.dispatch({} as EventDbClient, event)).rejects.toThrow(
      /unknown event handler/i,
    );
  });

  it('fans out to independently named consumers', async () => {
    const dispatcher = new EventDispatcher();
    const calls: string[] = [];
    dispatcher.register('projection-a', 'foundation.probe.recorded', 1, () => { calls.push('a'); return Promise.resolve(); });
    dispatcher.register('projection-b', 'foundation.probe.recorded', 1, () => { calls.push('b'); return Promise.resolve(); });

    await dispatcher.dispatch({} as EventDbClient, event);

    expect(calls).toEqual(['a', 'b']);
  });
});
