import { describe, expect, it } from 'vitest';
import { createDomainEvent, sanitizeError } from '../../src/events/domain-event.factory.js';

const input = {
  eventType: 'foundation.probe.recorded',
  eventVersion: 1,
  occurredAt: '2026-10-06T19:00:00.000Z',
  actor: { type: 'SYSTEM' as const },
  aggregate: { type: 'FoundationProbe', id: '0f8fad5b-d9cb-469f-a165-70867728950e' },
  correlationId: '0f8fad5b-d9cb-469f-a165-70867728950e',
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

  it('protects nested payloads and rejects secret-shaped keys', () => {
    const payload = { items: [{ label: 'ok' }] };
    const event = createDomainEvent({ ...input, payload });
    expect(() => ((event.payload.items as Array<{ label: string }>)[0]!.label = 'changed')).toThrow();
    expect(() => createDomainEvent({ ...input, payload: { ApiKey: 'secret' } })).toThrow(/secret/i);
  });

  it('requires strict event metadata', () => {
    expect(() => createDomainEvent({ ...input, occurredAt: '2026-10-06' })).toThrow(/RFC3339/i);
    expect(() => createDomainEvent({ ...input, actor: { type: 'USER' } })).toThrow(/actor.id/i);
    expect(() => createDomainEvent({ ...input, requestId: 'bad\nrequest' })).toThrow(/requestId/i);
  });
});

describe('sanitizeError', () => {
  it('returns a bounded code and message without a stack', () => {
    const result = sanitizeError(new Error('private database details '.repeat(100)));

    expect(result.code).toBe('EVENT_PROCESSING_FAILED');
    expect(result.message).toBe('Event processing failed');
    expect(result.message).not.toContain('private');
    expect(result).not.toHaveProperty('stack');
  });
});
