import { randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';

export interface EventContext {
  readonly correlationId: string;
  readonly causationId?: string;
  readonly requestId?: string;
}

const contextStorage = new AsyncLocalStorage<EventContext>();

export function currentEventContext(): EventContext | undefined {
  return contextStorage.getStore();
}

export function runWithEventContext<T>(context: EventContext, callback: () => T): T {
  return contextStorage.run(context, callback);
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
