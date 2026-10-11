ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'SUBSCRIPTION_CREATED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'SUBSCRIPTION_TRANSITIONED';
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIALING', 'ACTIVE', 'PAST_DUE', 'SUSPENDED', 'EXPIRED', 'CANCELED');

CREATE TABLE "subscriptions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "plan_version_id" UUID NOT NULL,
    "status" "SubscriptionStatus" NOT NULL,
    "starts_at" TIMESTAMPTZ(6) NOT NULL,
    "ends_at" TIMESTAMPTZ(6),
    "canceled_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "subscriptions_dates_check" CHECK ("ends_at" IS NULL OR "ends_at" > "starts_at"),
    CONSTRAINT "subscriptions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "subscriptions_plan_version_id_fkey" FOREIGN KEY ("plan_version_id") REFERENCES "plan_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "subscriptions_organization_id_status_starts_at_ends_at_idx" ON "subscriptions"("organization_id", "status", "starts_at", "ends_at");
CREATE INDEX "subscriptions_plan_version_id_idx" ON "subscriptions"("plan_version_id");
CREATE UNIQUE INDEX "subscriptions_one_open_lifecycle_per_organization_key"
  ON "subscriptions"("organization_id")
  WHERE "ends_at" IS NULL AND "status" IN ('TRIALING', 'ACTIVE', 'PAST_DUE', 'SUSPENDED');
