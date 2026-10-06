import { randomUUID } from 'node:crypto';
import type { ClaimedOutboxEvent, EventDbClient } from './outbox.repository.js';

export class FoundationProbeConsumer {
  readonly consumerName = 'foundation-probe-projection';

  async handle(client: EventDbClient, event: ClaimedOutboxEvent): Promise<void> {
    const receipt = await client.query(
      `INSERT INTO event_consumer_receipts (id, consumer_name, event_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (consumer_name, event_id) DO NOTHING
       RETURNING id`,
      [randomUUID(), this.consumerName, event.id],
    );
    if (receipt.rowCount === 0) return;

    const value = event.payload.value;
    if (typeof value !== 'string' || !value.trim()) throw new Error('foundation probe payload is invalid');
    await client.query(
      `INSERT INTO foundation_probe_projections (id, event_id, value)
       VALUES ($1, $2, $3)`,
      [randomUUID(), event.id, value],
    );
  }
}
