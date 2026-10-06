import type { ClaimedOutboxEvent, EventDbClient } from './outbox.repository.js';

export type EventHandler = (client: EventDbClient, event: ClaimedOutboxEvent) => Promise<void>;

export class EventDispatcher {
  private readonly handlers = new Map<string, EventHandler>();

  register(eventType: string, eventVersion: number, handler: EventHandler): void {
    this.handlers.set(`${eventType}:${eventVersion}`, handler);
  }

  async dispatch(client: EventDbClient, event: ClaimedOutboxEvent): Promise<void> {
    const handler = this.handlers.get(`${event.eventType}:${event.eventVersion}`);
    if (!handler) {
      throw new Error(`Unknown event handler: ${event.eventType} v${event.eventVersion}`);
    }
    await handler(client, event);
  }
}
