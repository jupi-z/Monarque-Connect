import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { createDomainEvent } from './domain-event.factory.js';
import type { EventContext } from './event-context.js';
import { PrismaOutboxWriter } from './prisma-outbox.writer.js';

type PrismaFoundationTransaction = {
  foundationProbe: {
    create(args: { data: { id: string; value: string } }): Promise<unknown>;
  };
};

@Injectable()
export class PrismaFoundationProbeService {
  constructor(private readonly outbox: PrismaOutboxWriter) {}

  async recordFoundationProbe(
    tx: unknown,
    value: string,
    context: EventContext,
  ): Promise<{ probeId: string; eventId: string }> {
    if (!value.trim() || value.length > 200) throw new Error('foundation probe value is invalid');

    const probeId = randomUUID();
    const client = tx as PrismaFoundationTransaction;
    await client.foundationProbe.create({ data: { id: probeId, value } });
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
    await this.outbox.enqueue(tx, event);
    return { probeId, eventId: event.eventId };
  }
}
