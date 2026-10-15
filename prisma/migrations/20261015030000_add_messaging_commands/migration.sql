-- Phase 9 Task 3: conversation/invitation command receipts and audit vocabulary.
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'MESSAGING_CONVERSATION_CREATED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'MESSAGING_INVITATION_CREATED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'MESSAGING_INVITATION_TOKEN_ISSUED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'MESSAGING_INVITATION_ACCEPTED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'MESSAGING_INVITATION_DECLINED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'MESSAGING_PARTICIPANT_INVITED';

ALTER TABLE "messaging_invitations"
  DROP CONSTRAINT IF EXISTS "messaging_invitations_distinct_organizations_check";
ALTER TABLE "messaging_invitations"
  ADD CONSTRAINT "messaging_invitations_organization_semantics_check" CHECK (
    ("type" = 'ORGANIZATION' AND "organization_id" <> "target_organization_id")
    OR ("type" = 'USER' AND "organization_id" = "target_organization_id")
  );

CREATE TABLE "messaging_command_receipts" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "actor_user_id" UUID NOT NULL,
    "operation" VARCHAR(80) NOT NULL,
    "idempotency_key" VARCHAR(200) NOT NULL,
    "payload_hash" VARCHAR(128) NOT NULL,
    "resource_type" VARCHAR(80) NOT NULL,
    "resource_id" UUID NOT NULL,
    "response_json" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "messaging_command_receipts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "messaging_command_receipts_organization_id_fkey"
      FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "messaging_command_receipts_actor_user_id_fkey"
      FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "messaging_command_receipts_scope_key"
  ON "messaging_command_receipts"("organization_id", "actor_user_id", "operation", "idempotency_key");
CREATE INDEX "messaging_command_receipts_organization_id_created_at_idx"
  ON "messaging_command_receipts"("organization_id", "created_at");
