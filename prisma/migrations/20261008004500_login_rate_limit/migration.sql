CREATE TABLE "login_rate_limit_buckets" (
    "key_hash" VARCHAR(128) NOT NULL,
    "failures" INTEGER NOT NULL DEFAULT 0,
    "blocked_until" TIMESTAMPTZ(6),
    "window_started" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "login_rate_limit_buckets_pkey" PRIMARY KEY ("key_hash")
);
