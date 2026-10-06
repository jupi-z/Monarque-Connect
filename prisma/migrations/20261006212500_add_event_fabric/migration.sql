CREATE TYPE "EventActorType" AS ENUM ('USER', 'SYSTEM', 'AGENT', 'PLATFORM');
CREATE TYPE "EventDataClassification" AS ENUM ('PUBLIC', 'INTERNAL', 'CONFIDENTIAL', 'RESTRICTED');
CREATE TYPE "OutboxEventStatus" AS ENUM ('PENDING', 'PROCESSING', 'PROCESSED', 'FAILED');

CREATE TABLE "outbox_events" (
    "id" UUID NOT NULL,
    "event_type" VARCHAR(160) NOT NULL,
    "event_version" INTEGER NOT NULL,
    "organization_id" UUID,
    "establishment_id" UUID,
    "actor_type" "EventActorType" NOT NULL,
    "actor_id" UUID,
    "aggregate_type" VARCHAR(120) NOT NULL,
    "aggregate_id" UUID NOT NULL,
    "correlation_id" UUID NOT NULL,
    "causation_id" UUID,
    "request_id" VARCHAR(200),
    "data_classification" "EventDataClassification" NOT NULL,
    "purpose" VARCHAR(200) NOT NULL,
    "payload_json" JSONB NOT NULL,
    "status" "OutboxEventStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(6),
    "locked_at" TIMESTAMPTZ(6),
    "locked_by" VARCHAR(160),
    "processed_at" TIMESTAMPTZ(6),
    "last_error_code" VARCHAR(120),
    "last_error_message" VARCHAR(1000),
    "occurred_at" TIMESTAMPTZ(6) NOT NULL,
    "recorded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "outbox_events_event_version_check" CHECK ("event_version" >= 1),
    CONSTRAINT "outbox_events_attempts_check" CHECK ("attempts" >= 0),
    CONSTRAINT "outbox_events_payload_object_check" CHECK (jsonb_typeof("payload_json") = 'object')
);

CREATE TABLE "event_consumer_receipts" (
    "id" UUID NOT NULL,
    "consumer_name" VARCHAR(160) NOT NULL,
    "event_id" UUID NOT NULL,
    "processed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "event_consumer_receipts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "event_consumer_receipts_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "outbox_events"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "event_consumer_receipts_consumer_name_event_id_key" ON "event_consumer_receipts"("consumer_name", "event_id");
CREATE INDEX "event_consumer_receipts_event_id_idx" ON "event_consumer_receipts"("event_id");
CREATE INDEX "outbox_events_status_next_attempt_at_recorded_at_idx" ON "outbox_events"("status", "next_attempt_at", "recorded_at");
CREATE INDEX "outbox_events_organization_id_recorded_at_idx" ON "outbox_events"("organization_id", "recorded_at");
CREATE INDEX "outbox_events_aggregate_type_aggregate_id_recorded_at_idx" ON "outbox_events"("aggregate_type", "aggregate_id", "recorded_at");
CREATE INDEX "outbox_events_correlation_id_idx" ON "outbox_events"("correlation_id");
