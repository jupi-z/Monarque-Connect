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

const RESERVED_KEY_PATTERN = /password|secret|token|authorization|api[-_]?key/i;

function assertUuid(value: string, field: string): void {
  if (!isUuid(value)) throw new Error(`${field} must be a UUID`);
}

function assertSafePayload(value: unknown, path = 'payload', root = true): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || (root && Array.isArray(value))) {
    throw new Error(`${path} must be a JSON object`);
  }
  if (Array.isArray(value)) {
    value.forEach((child, index) => {
      if (child !== null && typeof child === 'object') assertSafePayload(child, `${path}[${index}]`, false);
    });
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (RESERVED_KEY_PATTERN.test(key)) throw new Error(`${path}.${key} is a secret field`);
    if (child !== null && typeof child === 'object') assertSafePayload(child, `${path}.${key}`, false);
  }
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

export function createDomainEvent<TPayload extends Record<string, unknown>>(
  input: DomainEventInput<TPayload>,
): DomainEvent<TPayload> {
  if (!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(input.eventType)) {
    throw new Error('eventType must be a stable dotted name');
  }
  if (!Number.isInteger(input.eventVersion) || input.eventVersion < 1) {
    throw new Error('eventVersion must be an integer >= 1');
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(input.occurredAt) || Number.isNaN(Date.parse(input.occurredAt))) {
    throw new Error('occurredAt must be RFC3339');
  }
  if (!ACTOR_TYPES.includes(input.actor.type)) throw new Error('actor.type is invalid');
  if (input.actor.type === 'USER' && !input.actor.id) throw new Error('actor.id is required for USER actors');
  if (input.actor.id) assertUuid(input.actor.id, 'actor.id');
  if (!input.aggregate.type || !input.aggregate.id) throw new Error('aggregate is required');
  assertUuid(input.aggregate.id, 'aggregate.id');
  assertUuid(input.correlationId, 'correlationId');
  if (input.causationId) assertUuid(input.causationId, 'causationId');
  if (input.requestId && (input.requestId.length > 200 || /[\r\n]/.test(input.requestId))) throw new Error('requestId is invalid');
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
    payload: deepFreeze(structuredClone(input.payload)),
  });
}

export function sanitizeError(error: unknown): { code: string; message: string } {
  return {
    code: 'EVENT_PROCESSING_FAILED',
    message: error instanceof Error && error.name === 'PermanentEventError'
      ? 'Event rejected permanently'
      : 'Event processing failed',
  };
}
