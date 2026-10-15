-- Phase 9: audited, idempotent Control Plane command for Network verification.
ALTER TYPE "AuditAction" ADD VALUE 'NETWORK_TRUST_CHANGED';

CREATE TABLE "network_trust_command_receipts" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "actor_user_id" UUID NOT NULL,
    "idempotency_key" VARCHAR(200) NOT NULL,
    "payload_hash" VARCHAR(128) NOT NULL,
    "verification_status" "NetworkVerificationStatus" NOT NULL,
    "verified_at" TIMESTAMPTZ(6),
    "verification_expires_at" TIMESTAMPTZ(6),
    "reason" VARCHAR(500) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "network_trust_command_receipts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "network_trust_command_receipts_organization_id_actor_user_id_idempotency_key_key"
  ON "network_trust_command_receipts"("organization_id", "actor_user_id", "idempotency_key");
CREATE INDEX "network_trust_command_receipts_organization_id_created_at_idx"
  ON "network_trust_command_receipts"("organization_id", "created_at");

ALTER TABLE "network_trust_command_receipts"
  ADD CONSTRAINT "network_trust_command_receipts_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "network_trust_command_receipts_actor_user_id_fkey"
  FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
