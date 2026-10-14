-- Phase 7 Task 5: tenant-scoped Cash accounts and append-only cash ledger.
CREATE TYPE "CashAccountStatus" AS ENUM ('ACTIVE', 'INACTIVE');
CREATE TYPE "CashMovementDirection" AS ENUM ('IN', 'OUT');
CREATE TYPE "CashMovementSourceType" AS ENUM ('PAYMENT_RECORD', 'EXPENSE', 'TRANSFER', 'CORRECTION');
ALTER TYPE "AuditAction" ADD VALUE 'CASH_ACCOUNT_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'CASH_ACCOUNT_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE 'CASH_ACCOUNT_DEACTIVATED';
ALTER TYPE "AuditAction" ADD VALUE 'CASH_ACCOUNT_REACTIVATED';
ALTER TYPE "AuditAction" ADD VALUE 'CASH_MOVEMENT_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'CASH_MOVEMENT_CORRECTED';
ALTER TYPE "AuditAction" ADD VALUE 'CASH_TRANSFER_CREATED';

CREATE TABLE "cash_accounts" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "establishment_id" UUID NOT NULL,
    "code" VARCHAR(32) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "status" "CashAccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "cash_accounts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "cash_accounts_code_nonempty_check" CHECK (char_length(btrim("code")) BETWEEN 2 AND 32),
    CONSTRAINT "cash_accounts_name_nonempty_check" CHECK (char_length(btrim("name")) BETWEEN 1 AND 160),
    CONSTRAINT "cash_accounts_code_format_check" CHECK ("code" ~ '^[A-Z0-9][A-Z0-9_-]{1,31}$'),
    CONSTRAINT "cash_accounts_currency_uppercase_check" CHECK ("currency" ~ '^[A-Z]{3}$')
);

CREATE TABLE "cash_account_idempotency_keys" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "actor_user_id" UUID NOT NULL,
    "operation" VARCHAR(64) NOT NULL,
    "key" VARCHAR(200) NOT NULL,
    "payload_hash" VARCHAR(128) NOT NULL,
    "establishment_id" UUID NOT NULL,
    "cash_account_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "cash_account_idempotency_keys_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "cash_movements" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "establishment_id" UUID NOT NULL,
    "cash_account_id" UUID NOT NULL,
    "direction" "CashMovementDirection" NOT NULL,
    "amount" DECIMAL(19,4) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL,
    "reason" VARCHAR(2000) NOT NULL,
    "source_type" "CashMovementSourceType",
    "source_id" UUID,
    "corrected_movement_id" UUID,
    "transfer_id" UUID,
    "idempotency_key" VARCHAR(200),
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "cash_movements_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "cash_movements_amount_positive_check" CHECK ("amount" > 0),
    CONSTRAINT "cash_movements_currency_uppercase_check" CHECK ("currency" ~ '^[A-Z]{3}$'),
    CONSTRAINT "cash_movements_reason_nonempty_check" CHECK (char_length(btrim("reason")) BETWEEN 1 AND 2000),
    CONSTRAINT "cash_movements_source_check" CHECK (("source_type" IS NULL AND "source_id" IS NULL) OR ("source_type" IS NOT NULL AND "source_id" IS NOT NULL)),
    CONSTRAINT "cash_movements_correction_check" CHECK (("source_type" = 'CORRECTION' AND "corrected_movement_id" IS NOT NULL) OR ("source_type" <> 'CORRECTION' AND "corrected_movement_id" IS NULL))
);

CREATE TABLE "cash_movement_idempotency_keys" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "actor_user_id" UUID NOT NULL,
    "operation" VARCHAR(64) NOT NULL,
    "key" VARCHAR(200) NOT NULL,
    "payload_hash" VARCHAR(128) NOT NULL,
    "establishment_id" UUID NOT NULL,
    "movement_id" UUID,
    "transfer_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "cash_movement_idempotency_keys_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "cash_accounts_id_organization_id_key" ON "cash_accounts"("id", "organization_id");
CREATE UNIQUE INDEX "cash_accounts_organization_id_code_key" ON "cash_accounts"("organization_id", "code");
CREATE INDEX "cash_accounts_organization_id_establishment_id_status_created_at_id_idx" ON "cash_accounts"("organization_id", "establishment_id", "status", "created_at", "id");
CREATE UNIQUE INDEX "cash_account_idempotency_keys_organization_id_actor_user_id_operation_key_key" ON "cash_account_idempotency_keys"("organization_id", "actor_user_id", "operation", "key");
CREATE INDEX "cash_account_idempotency_keys_organization_id_cash_account_id_created_at_idx" ON "cash_account_idempotency_keys"("organization_id", "cash_account_id", "created_at");
CREATE UNIQUE INDEX "cash_movements_id_organization_id_key" ON "cash_movements"("id", "organization_id");
CREATE UNIQUE INDEX "cash_movements_corrected_movement_id_organization_id_key" ON "cash_movements"("corrected_movement_id", "organization_id");
CREATE UNIQUE INDEX "cash_movements_source_expense_key" ON "cash_movements"("organization_id", "source_type", "source_id") WHERE "source_type" = 'EXPENSE' AND "source_id" IS NOT NULL;
CREATE UNIQUE INDEX "cash_movements_source_payment_record_key" ON "cash_movements"("organization_id", "source_type", "source_id") WHERE "source_type" = 'PAYMENT_RECORD' AND "source_id" IS NOT NULL;
CREATE INDEX "cash_movements_organization_id_cash_account_id_occurred_at_id_idx" ON "cash_movements"("organization_id", "cash_account_id", "occurred_at", "id");
CREATE INDEX "cash_movements_organization_id_establishment_id_occurred_at_id_idx" ON "cash_movements"("organization_id", "establishment_id", "occurred_at", "id");
CREATE INDEX "cash_movements_organization_id_source_type_source_id_idx" ON "cash_movements"("organization_id", "source_type", "source_id");
CREATE INDEX "cash_movements_organization_id_transfer_id_idx" ON "cash_movements"("organization_id", "transfer_id");
CREATE UNIQUE INDEX "cash_movement_idempotency_keys_organization_id_actor_user_id_operation_key_key" ON "cash_movement_idempotency_keys"("organization_id", "actor_user_id", "operation", "key");
CREATE INDEX "cash_movement_idempotency_keys_organization_id_movement_id_created_at_idx" ON "cash_movement_idempotency_keys"("organization_id", "movement_id", "created_at");
CREATE INDEX "cash_movement_idempotency_keys_organization_id_transfer_id_created_at_idx" ON "cash_movement_idempotency_keys"("organization_id", "transfer_id", "created_at");

ALTER TABLE "cash_accounts" ADD CONSTRAINT "cash_accounts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "cash_accounts" ADD CONSTRAINT "cash_accounts_establishment_id_organization_id_fkey" FOREIGN KEY ("establishment_id", "organization_id") REFERENCES "establishments"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cash_accounts" ADD CONSTRAINT "cash_accounts_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cash_account_idempotency_keys" ADD CONSTRAINT "cash_account_idempotency_keys_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "cash_account_idempotency_keys" ADD CONSTRAINT "cash_account_idempotency_keys_cash_account_id_organization_id_fkey" FOREIGN KEY ("cash_account_id", "organization_id") REFERENCES "cash_accounts"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_establishment_id_organization_id_fkey" FOREIGN KEY ("establishment_id", "organization_id") REFERENCES "establishments"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_cash_account_id_organization_id_fkey" FOREIGN KEY ("cash_account_id", "organization_id") REFERENCES "cash_accounts"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_corrected_movement_id_organization_id_fkey" FOREIGN KEY ("corrected_movement_id", "organization_id") REFERENCES "cash_movements"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cash_movement_idempotency_keys" ADD CONSTRAINT "cash_movement_idempotency_keys_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "cash_movement_idempotency_keys" ADD CONSTRAINT "cash_movement_idempotency_keys_movement_id_organization_id_fkey" FOREIGN KEY ("movement_id", "organization_id") REFERENCES "cash_movements"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE FUNCTION "prevent_cash_movement_mutation"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Tenant deletion cascades are allowed; direct mutation while the tenant exists is not.
  IF EXISTS (SELECT 1 FROM "organizations" WHERE "id" = OLD."organization_id") THEN
    RAISE EXCEPTION 'Cash movement ledger is append-only';
  END IF;
  RETURN OLD;
END;
$$;

CREATE TRIGGER "cash_movements_append_only_update"
BEFORE UPDATE OR DELETE ON "cash_movements"
FOR EACH ROW EXECUTE FUNCTION "prevent_cash_movement_mutation"();
