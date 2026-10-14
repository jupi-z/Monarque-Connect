import { randomUUID } from 'node:crypto';
import type { ClaimedOutboxEvent, EventDbClient } from './outbox.repository.js';

export class EventReceiptConsumer {
  constructor(readonly consumerName: string) {}

  async handle(client: EventDbClient, event: ClaimedOutboxEvent): Promise<void> {
    await client.query(
      `INSERT INTO event_consumer_receipts (id, consumer_name, event_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (consumer_name, event_id) DO NOTHING`,
      [randomUUID(), this.consumerName, event.id],
    );
  }
}
