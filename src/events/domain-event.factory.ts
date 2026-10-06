import { randomUUID } from 'node:crypto';
import { validate as isUuid } from 'uuid';
import {
  ACTOR_TYPES,
  DATA_CLASSIFICATIONS,
  type DataClassification,
  type DomainEvent,
  type EventActor,
  type EventAggregate,
} from './domain-event.js';

export interface DomainEventInput<TPayload extends Record<string, unknown>> {
  eventType: string;
  eventVersion: number;
  occurredAt: string;
  organizationId?: string;
  establishmentId?: string;
  actor: EventActor;
  aggregate: EventAggregate;
  correlationId: string;
  causationId?: string;
  requestId?: string;
  dataClassification: DataClassification;
  purpose: string;
  payload: TPayload;
}

const RESERVED_KEYS = new Set(['password', 'passwordHash', 'secret', 'token', 'accessToken', 'refreshToken']);

function assertUuid(value: string, field: string): void {
  if (!isUuid(value)) throw new Error(`${field} must be a UUID`);
}

function assertSafePayload(value: unknown, path = 'payload'): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${path} must be a JSON object`);
  }
  for (const [key, child] of Object.entries(value)) {
    if (RESERVED_KEYS.has(key)) throw new Error(`${path}.${key} is a secret field`);
    if (child !== null && typeof child === 'object') assertSafePayload(child, `${path}.${key}`);
  }
}

export function createDomainEvent<TPayload extends Record<string, unknown>>(
  input: DomainEventInput<TPayload>,
): DomainEvent<TPayload> {
  if (!/^[a-z][a-z0-9]*(\.[a-z][a-z0-9_]*)+$/.test(input.eventType)) {
    throw new Error('eventType must be a stable dotted name');
  }
  if (!Number.isInteger(input.eventVersion) || input.eventVersion < 1) {
    throw new Error('eventVersion must be an integer >= 1');
  }
  if (Number.isNaN(Date.parse(input.occurredAt))) throw new Error('occurredAt must be RFC3339');
  if (!ACTOR_TYPES.includes(input.actor.type)) throw new Error('actor.type is invalid');
  if (input.actor.id) assertUuid(input.actor.id, 'actor.id');
  if (!input.aggregate.type || !input.aggregate.id) throw new Error('aggregate is required');
  assertUuid(input.aggregate.id, 'aggregate.id');
  assertUuid(input.correlationId, 'correlationId');
  if (input.causationId) assertUuid(input.causationId, 'causationId');
  if (input.organizationId) assertUuid(input.organizationId, 'organizationId');
  if (input.establishmentId) assertUuid(input.establishmentId, 'establishmentId');
  if (!DATA_CLASSIFICATIONS.includes(input.dataClassification)) {
    throw new Error('dataClassification is invalid');
  }
  if (!input.purpose.trim()) throw new Error('purpose is required');
  assertSafePayload(input.payload);

  return Object.freeze({
    ...input,
    eventId: randomUUID(),
    recordedAt: new Date().toISOString(),
    actor: Object.freeze({ ...input.actor }),
    aggregate: Object.freeze({ ...input.aggregate }),
    payload: Object.freeze({ ...input.payload }),
  });
}

export function sanitizeError(error: unknown): { code: string; message: string } {
  const message = error instanceof Error ? error.message : 'Unknown event processing failure';
  return {
    code: 'EVENT_PROCESSING_FAILED',
    message: message.replace(/[\r\n]/g, ' ').slice(0, 1000),
  };
}

