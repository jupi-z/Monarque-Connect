import type { DomainEvent } from './domain-event.js';

type TransactionOutboxClient = {
  outboxEvent: {
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
  };
};

/** Transaction-bound writer for application services already using Prisma. */
export class PrismaOutboxWriter {
  async enqueue(tx: unknown, event: DomainEvent): Promise<void> {
    const client = tx as TransactionOutboxClient;
    await client.outboxEvent.create({
      data: {
        id: event.eventId,
        eventType: event.eventType,
        eventVersion: event.eventVersion,
        occurredAt: new Date(event.occurredAt),
        organizationId: event.organizationId ?? null,
        establishmentId: event.establishmentId ?? null,
        actorType: event.actor.type,
        actorId: event.actor.id ?? null,
        aggregateType: event.aggregate.type,
        aggregateId: event.aggregate.id,
        correlationId: event.correlationId,
        causationId: event.causationId ?? null,
        requestId: event.requestId ?? null,
        dataClassification: event.dataClassification,
        purpose: event.purpose,
        payloadJson: event.payload,
      },
    });
  }
}
