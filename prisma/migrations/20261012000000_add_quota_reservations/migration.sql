ALTER TYPE "AuditAction" ADD VALUE 'QUOTA_RESERVED';
ALTER TYPE "AuditAction" ADD VALUE 'QUOTA_COMMITTED';
ALTER TYPE "AuditAction" ADD VALUE 'QUOTA_RELEASED';

CREATE TYPE "QuotaReservationStatus" AS ENUM ('HELD', 'COMMITTED', 'RELEASED');
CREATE TYPE "QuotaLedgerOperation" AS ENUM ('RESERVED', 'COMMITTED', 'RELEASED');

CREATE TABLE "organization_quota_usages" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "quota_code" VARCHAR(80) NOT NULL,
    "period_key" VARCHAR(32) NOT NULL,
    "limit_value" BIGINT NOT NULL,
    "used_value" BIGINT NOT NULL DEFAULT 0,
    "reserved_value" BIGINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "organization_quota_usages_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "organization_quota_usages_values_check" CHECK ("limit_value" >= 0 AND "used_value" >= 0 AND "reserved_value" >= 0)
);
CREATE UNIQUE INDEX "organization_quota_usages_organization_id_quota_code_period_key_key"
  ON "organization_quota_usages"("organization_id", "quota_code", "period_key");
CREATE INDEX "organization_quota_usages_organization_id_period_key_idx"
  ON "organization_quota_usages"("organization_id", "period_key");

CREATE TABLE "quota_reservations" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "quota_code" VARCHAR(80) NOT NULL,
    "period_key" VARCHAR(32) NOT NULL,
    "amount" BIGINT NOT NULL,
    "limit_value" BIGINT NOT NULL,
    "status" "QuotaReservationStatus" NOT NULL,
    "idempotency_key" VARCHAR(200) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "quota_reservations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "quota_reservations_amount_check" CHECK ("amount" > 0)
);
CREATE UNIQUE INDEX "quota_reservations_organization_id_idempotency_key_key"
  ON "quota_reservations"("organization_id", "idempotency_key");
CREATE INDEX "quota_reservations_organization_id_quota_code_period_key_status_idx"
  ON "quota_reservations"("organization_id", "quota_code", "period_key", "status");

CREATE TABLE "quota_ledgers" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "quota_code" VARCHAR(80) NOT NULL,
    "period_key" VARCHAR(32) NOT NULL,
    "reservation_id" UUID NOT NULL,
    "operation" "QuotaLedgerOperation" NOT NULL,
    "amount" BIGINT NOT NULL,
    "metadata_json" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "quota_ledgers_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "quota_ledgers_amount_check" CHECK ("amount" > 0)
);
CREATE UNIQUE INDEX "quota_ledgers_reservation_id_operation_key"
  ON "quota_ledgers"("reservation_id", "operation");
CREATE INDEX "quota_ledgers_organization_id_quota_code_period_key_created_at_idx"
  ON "quota_ledgers"("organization_id", "quota_code", "period_key", "created_at");

ALTER TABLE "organization_quota_usages"
  ADD CONSTRAINT "organization_quota_usages_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "quota_reservations"
  ADD CONSTRAINT "quota_reservations_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "quota_reservations"
  ADD CONSTRAINT "quota_reservations_usage_fkey"
  FOREIGN KEY ("organization_id", "quota_code", "period_key") REFERENCES "organization_quota_usages"("organization_id", "quota_code", "period_key") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "quota_ledgers"
  ADD CONSTRAINT "quota_ledgers_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "quota_ledgers"
  ADD CONSTRAINT "quota_ledgers_usage_fkey"
  FOREIGN KEY ("organization_id", "quota_code", "period_key") REFERENCES "organization_quota_usages"("organization_id", "quota_code", "period_key") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "quota_ledgers"
  ADD CONSTRAINT "quota_ledgers_reservation_id_fkey"
  FOREIGN KEY ("reservation_id") REFERENCES "quota_reservations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
