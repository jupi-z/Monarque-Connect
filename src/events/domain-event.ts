export const ACTOR_TYPES = ['USER', 'SYSTEM', 'AGENT', 'PLATFORM'] as const;
export type ActorType = (typeof ACTOR_TYPES)[number];

export const DATA_CLASSIFICATIONS = ['PUBLIC', 'INTERNAL', 'CONFIDENTIAL', 'RESTRICTED'] as const;
export type DataClassification = (typeof DATA_CLASSIFICATIONS)[number];

export interface EventActor {
  type: ActorType;
  id?: string;
}

export interface EventAggregate {
  type: string;
  id: string;
}

export interface DomainEvent<TPayload extends Record<string, unknown> = Record<string, unknown>> {
  readonly eventId: string;
  readonly eventType: string;
  readonly eventVersion: number;
  readonly occurredAt: string;
  readonly recordedAt: string;
  readonly organizationId?: string;
  readonly establishmentId?: string;
  readonly actor: Readonly<EventActor>;
  readonly aggregate: Readonly<EventAggregate>;
  readonly correlationId: string;
  readonly causationId?: string;
  readonly requestId?: string;
  readonly dataClassification: DataClassification;
  readonly purpose: string;
  readonly payload: Readonly<TPayload>;
}

