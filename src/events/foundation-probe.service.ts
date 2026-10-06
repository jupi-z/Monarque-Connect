import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { createDomainEvent } from './domain-event.factory.js';
import type { EventContext } from './event-context.js';
import { OutboxRepository } from './outbox.repository.js';

export class FoundationProbeService {
  constructor(private readonly outbox: OutboxRepository) {}

  async recordFoundationProbe(
    client: Pick<PoolClient, 'query'>,
    value: string,
    context: EventContext,
  ): Promise<{ probeId: string; eventId: string }> {
    if (!value.trim() || value.length > 200) throw new Error('foundation probe value is invalid');

    const probeId = randomUUID();
    await client.query('INSERT INTO foundation_probes (id, value) VALUES ($1, $2)', [probeId, value]);
    const event = createDomainEvent({
      eventType: 'foundation.probe.recorded',
      eventVersion: 1,
      occurredAt: new Date().toISOString(),
      actor: { type: 'SYSTEM' },
      aggregate: { type: 'FoundationProbe', id: probeId },
      correlationId: context.correlationId,
      dataClassification: 'INTERNAL',
      purpose: 'phase-0.5-proof',
      payload: { value },
      ...(context.causationId ? { causationId: context.causationId } : {}),
      ...(context.requestId ? { requestId: context.requestId } : {}),
    });
    await this.outbox.enqueue(client, event);
    return { probeId, eventId: event.eventId };
  }
}
