ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'BILLING_CUSTOMER_VERIFICATION_CHANGED';

CREATE TABLE "billing_customer_verification_receipts" (
    "id" UUID NOT NULL,
    "billing_customer_id" UUID NOT NULL,
    "actor_user_id" UUID NOT NULL,
    "idempotency_key" VARCHAR(200) NOT NULL,
    "payload_hash" CHAR(64) NOT NULL,
    "verification_status" "BillingCustomerStatus" NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "billing_customer_verification_receipts_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "billing_customer_verification_receipts"
ADD CONSTRAINT "billing_customer_verification_receipts_billing_customer_id_fkey"
FOREIGN KEY ("billing_customer_id") REFERENCES "billing_customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "billing_customer_verification_receipts_billing_customer_id_actor_user_id_idempotency_key_key"
ON "billing_customer_verification_receipts"("billing_customer_id", "actor_user_id", "idempotency_key");

CREATE INDEX "billing_customer_verification_receipts_billing_customer_id_created_at_idx"
ON "billing_customer_verification_receipts"("billing_customer_id", "created_at");
