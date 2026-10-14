-- Phase 9: bilateral B2B messaging persistence and PostgreSQL invariants.
CREATE TYPE "MessagingConversationStatus" AS ENUM ('OPEN', 'SUSPENDED');
CREATE TYPE "MessagingInvitationType" AS ENUM ('ORGANIZATION', 'USER');
CREATE TYPE "MessagingInvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'REVOKED', 'EXPIRED');
CREATE TYPE "MessagingParticipantStatus" AS ENUM ('ACTIVE', 'LEFT', 'REVOKED');

CREATE TABLE "conversations" (
    "id" UUID NOT NULL,
    "organization_low_id" UUID NOT NULL,
    "organization_high_id" UUID NOT NULL,
    "status" "MessagingConversationStatus" NOT NULL DEFAULT 'OPEN',
    "last_message_sequence" BIGINT NOT NULL DEFAULT 0,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "conversations_organization_pair_distinct_check" CHECK ("organization_low_id" <> "organization_high_id"),
    CONSTRAINT "conversations_organization_pair_canonical_check" CHECK ("organization_low_id" < "organization_high_id"),
    CONSTRAINT "conversations_last_message_sequence_check" CHECK ("last_message_sequence" >= 0)
);
CREATE UNIQUE INDEX "conversations_organization_low_id_organization_high_id_key"
  ON "conversations"("organization_low_id", "organization_high_id");
CREATE INDEX "conversations_organization_low_id_status_updated_at_idx"
  ON "conversations"("organization_low_id", "status", "updated_at");
CREATE INDEX "conversations_organization_high_id_status_updated_at_idx"
  ON "conversations"("organization_high_id", "status", "updated_at");

CREATE TABLE "conversation_organization_participants" (
    "id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "establishment_id" UUID,
    "status" "MessagingParticipantStatus" NOT NULL DEFAULT 'ACTIVE',
    "joined_at" TIMESTAMPTZ(6),
    "left_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),
    "history_visible_from_sequence" BIGINT NOT NULL DEFAULT 0,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "conversation_organization_participants_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "conversation_organization_participants_history_check" CHECK ("history_visible_from_sequence" >= 0)
);
CREATE UNIQUE INDEX "conversation_organization_participants_conversation_id_organization_id_key"
  ON "conversation_organization_participants"("conversation_id", "organization_id");
CREATE UNIQUE INDEX "conversation_organization_participants_id_organization_id_key"
  ON "conversation_organization_participants"("id", "organization_id");
CREATE INDEX "conversation_organization_participants_organization_id_status_updated_at_idx"
  ON "conversation_organization_participants"("organization_id", "status", "updated_at");

CREATE TABLE "conversation_user_participants" (
    "id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "status" "MessagingParticipantStatus" NOT NULL DEFAULT 'ACTIVE',
    "joined_at" TIMESTAMPTZ(6),
    "left_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),
    "history_visible_from_sequence" BIGINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "conversation_user_participants_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "conversation_user_participants_history_check" CHECK ("history_visible_from_sequence" >= 0)
);
CREATE UNIQUE INDEX "conversation_user_participants_conversation_id_organization_id_user_id_key"
  ON "conversation_user_participants"("conversation_id", "organization_id", "user_id");
CREATE UNIQUE INDEX "conversation_user_participants_id_organization_id_key"
  ON "conversation_user_participants"("id", "organization_id");
CREATE INDEX "conversation_user_participants_organization_id_user_id_status_idx"
  ON "conversation_user_participants"("organization_id", "user_id", "status");
CREATE INDEX "conversation_user_participants_conversation_id_status_joined_at_idx"
  ON "conversation_user_participants"("conversation_id", "status", "joined_at");

CREATE TABLE "messaging_invitations" (
    "id" UUID NOT NULL,
    "type" "MessagingInvitationType" NOT NULL,
    "status" "MessagingInvitationStatus" NOT NULL DEFAULT 'PENDING',
    "conversation_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "target_organization_id" UUID NOT NULL,
    "target_user_id" UUID,
    "token_digest" VARCHAR(128) NOT NULL,
    "token_ciphertext" VARCHAR(4096) NOT NULL,
    "token_issued_at" TIMESTAMPTZ(6) NOT NULL,
    "token_delivered_at" TIMESTAMPTZ(6),
    "token_expires_at" TIMESTAMPTZ(6) NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "accepted_at" TIMESTAMPTZ(6),
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "messaging_invitations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "messaging_invitations_target_check" CHECK (
      ("type" = 'ORGANIZATION' AND "target_user_id" IS NULL)
      OR ("type" = 'USER' AND "target_user_id" IS NOT NULL)
    ),
    CONSTRAINT "messaging_invitations_distinct_organizations_check" CHECK ("organization_id" <> "target_organization_id"),
    CONSTRAINT "messaging_invitations_expiry_check" CHECK ("token_expires_at" <= "expires_at")
);
CREATE UNIQUE INDEX "messaging_invitations_token_digest_key" ON "messaging_invitations"("token_digest");
CREATE UNIQUE INDEX "messaging_invitations_pending_target_key"
  ON "messaging_invitations"("conversation_id", "type", "target_organization_id", "target_user_id")
  WHERE "status" = 'PENDING';
CREATE INDEX "messaging_invitations_target_organization_id_type_status_expires_at_idx"
  ON "messaging_invitations"("target_organization_id", "type", "status", "expires_at");
CREATE INDEX "messaging_invitations_target_user_id_type_status_expires_at_idx"
  ON "messaging_invitations"("target_user_id", "type", "status", "expires_at");
CREATE INDEX "messaging_invitations_conversation_id_type_status_idx"
  ON "messaging_invitations"("conversation_id", "type", "status");

CREATE TABLE "messages" (
    "id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "sequence" BIGINT NOT NULL,
    "author_user_id" UUID NOT NULL,
    "source_organization_id" UUID NOT NULL,
    "client_message_id" VARCHAR(128) NOT NULL,
    "body" VARCHAR(10000) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "messages_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "messages_sequence_check" CHECK ("sequence" >= 1),
    CONSTRAINT "messages_body_check" CHECK (btrim("body") <> ''),
    CONSTRAINT "messages_client_message_id_check" CHECK ("client_message_id" ~ '^[A-Za-z0-9._:-]+$')
);
CREATE UNIQUE INDEX "messages_conversation_id_sequence_key" ON "messages"("conversation_id", "sequence");
CREATE UNIQUE INDEX "messages_conversation_id_author_user_id_client_message_id_key"
  ON "messages"("conversation_id", "author_user_id", "client_message_id");
CREATE INDEX "messages_conversation_id_sequence_idx" ON "messages"("conversation_id", "sequence");
CREATE INDEX "messages_source_organization_id_created_at_idx" ON "messages"("source_organization_id", "created_at");

CREATE TABLE "messaging_organization_blocks" (
    "id" UUID NOT NULL,
    "source_organization_id" UUID NOT NULL,
    "target_organization_id" UUID NOT NULL,
    "created_by_user_id" UUID NOT NULL,
    "reason" VARCHAR(500),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ(6),
    CONSTRAINT "messaging_organization_blocks_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "messaging_organization_blocks_distinct_organizations_check" CHECK ("source_organization_id" <> "target_organization_id")
);
CREATE UNIQUE INDEX "messaging_organization_blocks_source_organization_id_target_organization_id_key"
  ON "messaging_organization_blocks"("source_organization_id", "target_organization_id");
CREATE INDEX "messaging_organization_blocks_target_organization_id_active_idx"
  ON "messaging_organization_blocks"("target_organization_id", "active");

CREATE TABLE "messaging_rate_buckets" (
    "id" UUID NOT NULL,
    "organization_id" UUID,
    "conversation_id" UUID,
    "dimension" VARCHAR(32) NOT NULL,
    "dimension_key_hash" VARCHAR(128) NOT NULL,
    "window_started" TIMESTAMPTZ(6) NOT NULL,
    "window_ends" TIMESTAMPTZ(6) NOT NULL,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "accepted_count" INTEGER NOT NULL DEFAULT 0,
    "rejected_count" INTEGER NOT NULL DEFAULT 0,
    "blocked_until" TIMESTAMPTZ(6),
    "content_fingerprint_hmac" VARCHAR(128),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "messaging_rate_buckets_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "messaging_rate_buckets_counts_check" CHECK ("attempt_count" >= 0 AND "accepted_count" >= 0 AND "rejected_count" >= 0),
    CONSTRAINT "messaging_rate_buckets_window_check" CHECK ("window_ends" > "window_started")
);
CREATE UNIQUE INDEX "messaging_rate_buckets_dimension_key_hash_window_started_key"
  ON "messaging_rate_buckets"("dimension", "dimension_key_hash", "window_started");
CREATE INDEX "messaging_rate_buckets_organization_id_window_ends_idx"
  ON "messaging_rate_buckets"("organization_id", "window_ends");
CREATE INDEX "messaging_rate_buckets_conversation_id_window_ends_idx"
  ON "messaging_rate_buckets"("conversation_id", "window_ends");

ALTER TABLE "conversations"
  ADD CONSTRAINT "conversations_organization_low_id_fkey"
  FOREIGN KEY ("organization_low_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "conversations_organization_high_id_fkey"
  FOREIGN KEY ("organization_high_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "conversations_created_by_user_id_fkey"
  FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "conversation_organization_participants"
  ADD CONSTRAINT "conversation_organization_participants_conversation_id_fkey"
  FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "conversation_organization_participants_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "conversation_organization_participants_establishment_id_organization_id_fkey"
  FOREIGN KEY ("establishment_id", "organization_id") REFERENCES "establishments"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "conversation_organization_participants_created_by_user_id_fkey"
  FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "conversation_user_participants"
  ADD CONSTRAINT "conversation_user_participants_conversation_id_fkey"
  FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "conversation_user_participants_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "conversation_user_participants_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "messaging_invitations"
  ADD CONSTRAINT "messaging_invitations_conversation_id_fkey"
  FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "messaging_invitations_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "messaging_invitations_target_organization_id_fkey"
  FOREIGN KEY ("target_organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "messaging_invitations_target_user_id_fkey"
  FOREIGN KEY ("target_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "messaging_invitations_created_by_user_id_fkey"
  FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "messages"
  ADD CONSTRAINT "messages_conversation_id_fkey"
  FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "messages_author_user_id_fkey"
  FOREIGN KEY ("author_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "messages_source_organization_id_fkey"
  FOREIGN KEY ("source_organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "messaging_organization_blocks"
  ADD CONSTRAINT "messaging_organization_blocks_source_organization_id_fkey"
  FOREIGN KEY ("source_organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "messaging_organization_blocks_target_organization_id_fkey"
  FOREIGN KEY ("target_organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "messaging_organization_blocks_created_by_user_id_fkey"
  FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "messaging_rate_buckets"
  ADD CONSTRAINT "messaging_rate_buckets_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "messaging_rate_buckets_conversation_id_fkey"
  FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION "messaging_message_immutable"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'message_immutable' USING ERRCODE = 'P0001';
END;
$$;

CREATE TRIGGER "messages_immutable_before_update_or_delete"
BEFORE UPDATE OR DELETE ON "messages"
FOR EACH ROW EXECUTE FUNCTION "messaging_message_immutable"();

CREATE OR REPLACE FUNCTION "messaging_conversation_organization_pair_guard"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "conversations" c
    WHERE c."id" = NEW."conversation_id"
      AND (NEW."organization_id" = c."organization_low_id" OR NEW."organization_id" = c."organization_high_id")
  ) THEN
    RAISE EXCEPTION 'messaging_participant_organization_mismatch' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER "conversation_organization_participants_pair_guard"
AFTER INSERT OR UPDATE ON "conversation_organization_participants"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "messaging_conversation_organization_pair_guard"();

CREATE OR REPLACE FUNCTION "messaging_conversation_organization_count_guard"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  conversation_id UUID;
BEGIN
  conversation_id := CASE WHEN TG_OP = 'DELETE' THEN OLD."conversation_id" ELSE NEW."conversation_id" END;
  IF (SELECT COUNT(*) FROM "conversation_organization_participants" WHERE "conversation_id" = conversation_id) <> 2 THEN
    RAISE EXCEPTION 'messaging_conversation_requires_two_organizations' USING ERRCODE = 'P0001';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "conversation_organization_participants_exactly_two_guard"
AFTER INSERT OR UPDATE OR DELETE ON "conversation_organization_participants"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "messaging_conversation_organization_count_guard"();
