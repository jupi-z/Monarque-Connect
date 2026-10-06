import type { ClaimedOutboxEvent, EventDbClient } from './outbox.repository.js';

export type EventHandler = (client: EventDbClient, event: ClaimedOutboxEvent) => Promise<void>;

export class PermanentEventError extends Error {
  override readonly name = 'PermanentEventError';
}

export class EventDispatcher {
  private readonly handlers = new Map<string, Map<string, EventHandler>>();

  register(consumerName: string, eventType: string, eventVersion: number, handler: EventHandler): void;
  register(eventType: string, eventVersion: number, handler: EventHandler): void;
  register(first: string, second: string | number, third: number | EventHandler, fourth?: EventHandler): void {
    const legacy = typeof second === 'number';
    const consumerName = legacy ? 'default' : first;
    const eventType = legacy ? first : second;
    const eventVersion = legacy ? second : third;
    const handler = legacy ? third : fourth;
    if (typeof eventVersion !== 'number' || typeof handler !== 'function') throw new Error('Invalid event handler registration');
    const key = `${eventType}:${eventVersion}`;
    const consumers = this.handlers.get(key) ?? new Map<string, EventHandler>();
    if (consumers.has(consumerName)) throw new Error(`Duplicate event consumer: ${consumerName}`);
    consumers.set(consumerName, handler);
    this.handlers.set(key, consumers);
  }

  async dispatch(client: EventDbClient, event: ClaimedOutboxEvent): Promise<void> {
    const handlers = this.handlers.get(`${event.eventType}:${event.eventVersion}`);
    if (!handlers) {
      throw new PermanentEventError(`Unknown event handler: ${event.eventType} v${event.eventVersion}`);
    }
    for (const handler of handlers.values()) await handler(client, event);
  }
}
