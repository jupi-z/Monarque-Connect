import { describe, expect, it } from 'vitest';
import { createRequestContext, workerContextFor } from '../../src/events/event-context.js';

describe('event context', () => {
  it('creates server-owned request and correlation identifiers', () => {
    const context = createRequestContext();

    expect(context.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(context.correlationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(context.requestId).not.toBe(context.correlationId);
  });

  it('keeps correlation and points causation to the triggering event for workers', () => {
    const context = workerContextFor({
      eventId: '0f8fad5b-d9cb-469f-a165-70867728950e',
      correlationId: '9f8fad5b-d9cb-469f-a165-70867728950e',
      requestId: 'req-123',
    });

    expect(context).toEqual({
      correlationId: '9f8fad5b-d9cb-469f-a165-70867728950e',
      causationId: '0f8fad5b-d9cb-469f-a165-70867728950e',
      requestId: 'req-123',
    });
  });
});
