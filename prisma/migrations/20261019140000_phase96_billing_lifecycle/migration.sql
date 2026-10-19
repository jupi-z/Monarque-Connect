ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'BILLING_INVOICE_ISSUED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'BILLING_RENEWAL_SCHEDULED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'BILLING_DUNNING_TRANSITIONED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'BILLING_SCHEDULED_CHANGE_APPLIED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'BILLING_REFUND_RECORDED';

ALTER TABLE "billing_scheduled_changes" ADD COLUMN "idempotency_key" VARCHAR(200);
UPDATE "billing_scheduled_changes"
SET "idempotency_key" = 'migration:' || "id"
WHERE "idempotency_key" IS NULL;
ALTER TABLE "billing_scheduled_changes" ALTER COLUMN "idempotency_key" SET NOT NULL;
CREATE UNIQUE INDEX "billing_scheduled_changes_organization_id_idempotency_key_key"
  ON "billing_scheduled_changes"("organization_id", "idempotency_key");
