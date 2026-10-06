import type { PoolClient } from 'pg';
import type { DomainEvent } from './domain-event.js';

export type EventDbClient = Pick<PoolClient, 'query'>;

export interface ClaimedOutboxEvent {
  id: string;
  eventType: string;
  eventVersion: number;
  organizationId: string | null;
  establishmentId: string | null;
  actorType: string;
  actorId: string | null;
  aggregateType: string;
  aggregateId: string;
  correlationId: string;
  causationId: string | null;
  requestId: string | null;
  dataClassification: string;
  purpose: string;
  payload: Record<string, unknown>;
  status: 'PROCESSING';
  attempts: number;
  lockedBy: string | null;
  occurredAt: Date;
  recordedAt: Date;
}

export interface ClaimOptions {
  workerId: string;
  batchSize: number;
  leaseSeconds: number;
}

export class OutboxRepository {
  async enqueue(client: EventDbClient, event: DomainEvent): Promise<void> {
    await client.query(
      `INSERT INTO outbox_events
        (id, event_type, event_version, occurred_at, organization_id, establishment_id,
         actor_type, actor_id, aggregate_type, aggregate_id, correlation_id, causation_id,
         request_id, data_classification, purpose, payload_json)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16::jsonb)`,
      [
        event.eventId,
        event.eventType,
        event.eventVersion,
        event.occurredAt,
        event.organizationId ?? null,
        event.establishmentId ?? null,
        event.actor.type,
        event.actor.id ?? null,
        event.aggregate.type,
        event.aggregate.id,
        event.correlationId,
        event.causationId ?? null,
        event.requestId ?? null,
        event.dataClassification,
        event.purpose,
        JSON.stringify(event.payload),
      ],
    );
  }

  async claimBatch(client: EventDbClient, options: ClaimOptions): Promise<ClaimedOutboxEvent[]> {
    const result = await client.query(
      `WITH eligible AS (
         SELECT id
         FROM outbox_events
         WHERE (status = 'PENDING' AND (next_attempt_at IS NULL OR next_attempt_at <= now()))
            OR (status = 'PROCESSING' AND locked_at < now() - ($3 * interval '1 second'))
         ORDER BY recorded_at
         FOR UPDATE SKIP LOCKED
         LIMIT $1
       )
       UPDATE outbox_events AS e
       SET status = 'PROCESSING', attempts = e.attempts + 1, locked_at = now(), locked_by = $2
       FROM eligible
       WHERE e.id = eligible.id
       RETURNING e.*`,
      [options.batchSize, options.workerId, options.leaseSeconds],
    );
    return result.rows.map((row: unknown) => this.mapRow(row));
  }

  async markProcessed(client: EventDbClient, eventId: string): Promise<void> {
    await client.query(
      `UPDATE outbox_events
       SET status = 'PROCESSED', processed_at = now(), locked_at = null, locked_by = null,
           last_error_code = null, last_error_message = null
       WHERE id = $1 AND status = 'PROCESSING'`,
      [eventId],
    );
  }

  async markRetry(
    client: EventDbClient,
    eventId: string,
    nextAttemptAt: Date,
    error: { code: string; message: string },
  ): Promise<void> {
    await client.query(
      `UPDATE outbox_events
       SET status = 'PENDING', next_attempt_at = $2, locked_at = null, locked_by = null,
           last_error_code = $3, last_error_message = $4
       WHERE id = $1 AND status = 'PROCESSING'`,
      [eventId, nextAttemptAt, error.code.slice(0, 120), error.message.slice(0, 1000)],
    );
  }

  async markFailed(
    client: EventDbClient,
    eventId: string,
    error: { code: string; message: string },
  ): Promise<void> {
    await client.query(
      `UPDATE outbox_events
       SET status = 'FAILED', locked_at = null, locked_by = null,
           last_error_code = $2, last_error_message = $3
       WHERE id = $1 AND status = 'PROCESSING'`,
      [eventId, error.code.slice(0, 120), error.message.slice(0, 1000)],
    );
  }

  private mapRow(row: unknown): ClaimedOutboxEvent {
    const data = row as Record<string, unknown>;
    return {
      id: String(data.id),
      eventType: String(data.event_type),
      eventVersion: Number(data.event_version),
      organizationId: (data.organization_id as string | null) ?? null,
      establishmentId: (data.establishment_id as string | null) ?? null,
      actorType: String(data.actor_type),
      actorId: (data.actor_id as string | null) ?? null,
      aggregateType: String(data.aggregate_type),
      aggregateId: String(data.aggregate_id),
      correlationId: String(data.correlation_id),
      causationId: (data.causation_id as string | null) ?? null,
      requestId: (data.request_id as string | null) ?? null,
      dataClassification: String(data.data_classification),
      purpose: String(data.purpose),
      payload: (data.payload_json ?? {}) as Record<string, unknown>,
      status: 'PROCESSING',
      attempts: Number(data.attempts),
      lockedBy: (data.locked_by as string | null) ?? null,
      occurredAt: new Date(String(data.occurred_at)),
      recordedAt: new Date(String(data.recorded_at)),
    };
  }
}
