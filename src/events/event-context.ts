import { randomUUID } from 'node:crypto';

export interface EventContext {
  readonly correlationId: string;
  readonly causationId?: string;
  readonly requestId?: string;
}

export function createRequestContext(): EventContext & { requestId: string } {
  return {
    requestId: randomUUID(),
    correlationId: randomUUID(),
  };
}

export function workerContextFor(input: {
  eventId: string;
  correlationId: string;
  requestId?: string;
}): EventContext & { causationId: string } {
  return {
    correlationId: input.correlationId,
    causationId: input.eventId,
    ...(input.requestId ? { requestId: input.requestId } : {}),
  };
}

