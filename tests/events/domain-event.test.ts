import { describe, expect, it } from 'vitest';
import { createDomainEvent, sanitizeError } from '../../src/events/domain-event.factory.js';

const input = {
  eventType: 'foundation.probe.recorded',
  eventVersion: 1,
  occurredAt: '2026-10-06T19:00:00.000Z',
  organizationId: undefined,
  establishmentId: undefined,
  actor: { type: 'SYSTEM' as const },
  aggregate: { type: 'FoundationProbe', id: '0f8fad5b-d9cb-469f-a165-70867728950e' },
  correlationId: '0f8fad5b-d9cb-469f-a165-70867728950e',
  causationId: undefined,
  requestId: 'req-123',
  dataClassification: 'INTERNAL' as const,
  purpose: 'phase-0.5-proof',
  payload: { value: 'probe' },
};

describe('createDomainEvent', () => {
  it('creates a canonical immutable event envelope', () => {
    const event = createDomainEvent(input);

    expect(event).toMatchObject({
      eventType: input.eventType,
      eventVersion: 1,
      actor: { type: 'SYSTEM' },
      aggregate: input.aggregate,
      dataClassification: 'INTERNAL',
      payload: { value: 'probe' },
    });
    expect(event.eventId).toMatch(/^[0-9a-f-]{36}$/);
    expect(event.recordedAt).toMatch(/Z$/);
  });

  it('rejects payloads containing reserved secret fields', () => {
    expect(() => createDomainEvent({ ...input, payload: { token: 'secret' } })).toThrow(
      /secret/i,
    );
  });

  it('rejects non-object payloads', () => {
    expect(() => createDomainEvent({ ...input, payload: 'invalid' as never })).toThrow(
      /payload/i,
    );
  });
});

describe('sanitizeError', () => {
  it('returns a bounded code and message without a stack', () => {
    const result = sanitizeError(new Error('private database details '.repeat(100)));

    expect(result.code).toBe('EVENT_PROCESSING_FAILED');
    expect(result.message.length).toBeLessThanOrEqual(1000);
    expect(result).not.toHaveProperty('stack');
  });
});
