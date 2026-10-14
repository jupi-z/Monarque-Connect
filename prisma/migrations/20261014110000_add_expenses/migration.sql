-- Phase 7 Task 4: operational expenses. This is not an accounting or tax ledger.
CREATE TYPE "ExpenseStatus" AS ENUM ('DRAFT', 'RECORDED', 'VOID');
ALTER TYPE "AuditAction" ADD VALUE 'EXPENSE_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'EXPENSE_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE 'EXPENSE_RECORDED';
ALTER TYPE "AuditAction" ADD VALUE 'EXPENSE_VOIDED';

CREATE TABLE "expenses" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "establishment_id" UUID NOT NULL,
    "status" "ExpenseStatus" NOT NULL DEFAULT 'DRAFT',
    "description" VARCHAR(500) NOT NULL,
    "category" VARCHAR(80) NOT NULL,
    "amount" DECIMAL(19,4) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "expense_date" DATE NOT NULL,
    "party_id" UUID,
    "void_reason" VARCHAR(2000),
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "expenses_description_nonempty_check" CHECK (char_length(btrim("description")) BETWEEN 1 AND 500),
    CONSTRAINT "expenses_category_nonempty_check" CHECK (char_length(btrim("category")) BETWEEN 1 AND 80),
    CONSTRAINT "expenses_amount_positive_check" CHECK ("amount" > 0),
    CONSTRAINT "expenses_currency_uppercase_check" CHECK ("currency" ~ '^[A-Z]{3}$'),
    CONSTRAINT "expenses_void_reason_check" CHECK (("status" = 'VOID' AND char_length(btrim(COALESCE("void_reason", ''))) > 0) OR ("status" <> 'VOID' AND "void_reason" IS NULL))
);

CREATE TABLE "expense_idempotency_keys" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "actor_user_id" UUID NOT NULL,
    "operation" VARCHAR(64) NOT NULL,
    "key" VARCHAR(200) NOT NULL,
    "payload_hash" VARCHAR(128) NOT NULL,
    "establishment_id" UUID NOT NULL,
    "expense_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "expense_idempotency_keys_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "expenses_id_organization_id_key" ON "expenses"("id", "organization_id");
CREATE INDEX "expenses_organization_id_establishment_id_status_created_at_id_idx" ON "expenses"("organization_id", "establishment_id", "status", "created_at", "id");
CREATE INDEX "expenses_organization_id_party_id_created_at_idx" ON "expenses"("organization_id", "party_id", "created_at");
CREATE UNIQUE INDEX "expense_idempotency_keys_organization_id_actor_user_id_operation_key_key" ON "expense_idempotency_keys"("organization_id", "actor_user_id", "operation", "key");
CREATE INDEX "expense_idempotency_keys_organization_id_expense_id_created_at_idx" ON "expense_idempotency_keys"("organization_id", "expense_id", "created_at");

ALTER TABLE "expenses" ADD CONSTRAINT "expenses_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_establishment_id_organization_id_fkey" FOREIGN KEY ("establishment_id", "organization_id") REFERENCES "establishments"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_party_id_organization_id_fkey" FOREIGN KEY ("party_id", "organization_id") REFERENCES "business_parties"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "expense_idempotency_keys" ADD CONSTRAINT "expense_idempotency_keys_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "expense_idempotency_keys" ADD CONSTRAINT "expense_idempotency_keys_expense_id_organization_id_fkey" FOREIGN KEY ("expense_id", "organization_id") REFERENCES "expenses"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;
