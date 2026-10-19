CREATE TABLE "messaging_rate_bucket_fingerprints" (
    "id" UUID NOT NULL,
    "rate_bucket_id" UUID NOT NULL,
    "fingerprint_hmac" VARCHAR(128) NOT NULL,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "messaging_rate_bucket_fingerprints_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "messaging_rate_bucket_fingerprints_counts_check" CHECK ("attempt_count" >= 0)
);

CREATE UNIQUE INDEX "messaging_rate_bucket_fingerprints_rate_bucket_id_fingerprint_hmac_key"
  ON "messaging_rate_bucket_fingerprints"("rate_bucket_id", "fingerprint_hmac");
CREATE INDEX "messaging_rate_bucket_fingerprints_fingerprint_hmac_updated_at_idx"
  ON "messaging_rate_bucket_fingerprints"("fingerprint_hmac", "updated_at");

ALTER TABLE "messaging_rate_bucket_fingerprints"
  ADD CONSTRAINT "messaging_rate_bucket_fingerprints_rate_bucket_id_fkey"
  FOREIGN KEY ("rate_bucket_id") REFERENCES "messaging_rate_buckets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "messaging_rate_bucket_fingerprints" ("id", "rate_bucket_id", "fingerprint_hmac", "attempt_count", "created_at", "updated_at")
SELECT gen_random_uuid(), "id", "content_fingerprint_hmac", "fingerprint_count", "created_at", "updated_at"
FROM "messaging_rate_buckets"
WHERE "content_fingerprint_hmac" IS NOT NULL AND "fingerprint_count" > 0;
