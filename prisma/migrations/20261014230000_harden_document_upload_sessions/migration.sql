-- Phase 8 hardening: persist the opaque upload session credentials for safe idempotent replays.
ALTER TABLE "documents"
  ADD COLUMN "upload_token" VARCHAR(2048),
  ADD COLUMN "upload_expires_at" TIMESTAMPTZ(6);
