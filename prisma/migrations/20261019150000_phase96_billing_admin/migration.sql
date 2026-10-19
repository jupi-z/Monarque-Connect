ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'BILLING_PRICE_VERSION_PUBLISHED';

ALTER TABLE "price_versions" ADD COLUMN "idempotency_key" VARCHAR(200);
CREATE UNIQUE INDEX "price_versions_idempotency_key_key" ON "price_versions"("idempotency_key");
