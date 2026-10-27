-- C1.2: add product ownership without changing existing identifiers or values.
-- Every pre-existing row is assigned to Monarque Connect by the column default.
CREATE TABLE "product_catalog" (
  "code" VARCHAR(64) NOT NULL,
  "display_name" VARCHAR(120) NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "product_catalog_pkey" PRIMARY KEY ("code")
);

INSERT INTO "product_catalog" ("code", "display_name") VALUES
  ('MONARQUE_CONNECT', 'Monarque Connect'),
  ('ZAMUREK', 'ZAMUREK');

ALTER TABLE "plans" ADD COLUMN "product_code" VARCHAR(64) NOT NULL DEFAULT 'MONARQUE_CONNECT';
ALTER TABLE "plan_versions" ADD COLUMN "product_code" VARCHAR(64) NOT NULL DEFAULT 'MONARQUE_CONNECT';
ALTER TABLE "price_versions" ADD COLUMN "product_code" VARCHAR(64) NOT NULL DEFAULT 'MONARQUE_CONNECT';
ALTER TABLE "subscriptions" ADD COLUMN "product_code" VARCHAR(64) NOT NULL DEFAULT 'MONARQUE_CONNECT';
ALTER TABLE "billing_subscription_terms" ADD COLUMN "product_code" VARCHAR(64) NOT NULL DEFAULT 'MONARQUE_CONNECT';
ALTER TABLE "organization_module_activations" ADD COLUMN "product_code" VARCHAR(64) NOT NULL DEFAULT 'MONARQUE_CONNECT';
ALTER TABLE "organization_entitlements" ADD COLUMN "product_code" VARCHAR(64) NOT NULL DEFAULT 'MONARQUE_CONNECT';
ALTER TABLE "organization_quota_usages" ADD COLUMN "product_code" VARCHAR(64) NOT NULL DEFAULT 'MONARQUE_CONNECT';
ALTER TABLE "quota_reservations" ADD COLUMN "product_code" VARCHAR(64) NOT NULL DEFAULT 'MONARQUE_CONNECT';
ALTER TABLE "quota_ledgers" ADD COLUMN "product_code" VARCHAR(64) NOT NULL DEFAULT 'MONARQUE_CONNECT';

-- Keep existing globally unique plan codes during the compatibility window,
-- while adding product-composite keys required for scoped foreign keys.
ALTER TABLE "plans" ADD CONSTRAINT "plans_product_code_code_key" UNIQUE ("product_code", "code");
ALTER TABLE "plan_versions" ADD CONSTRAINT "plan_versions_product_code_id_key" UNIQUE ("product_code", "id");
ALTER TABLE "price_versions" ADD CONSTRAINT "price_versions_product_code_id_key" UNIQUE ("product_code", "id");
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_id_product_code_key" UNIQUE ("id", "product_code");
ALTER TABLE "quota_reservations" ADD CONSTRAINT "quota_reservations_id_product_code_key" UNIQUE ("id", "product_code");

-- Constrain product ownership through the controlled server-side catalog.
ALTER TABLE "plans" ADD CONSTRAINT "plans_product_code_fkey" FOREIGN KEY ("product_code") REFERENCES "product_catalog"("code") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "plan_versions" ADD CONSTRAINT "plan_versions_product_code_fkey" FOREIGN KEY ("product_code") REFERENCES "product_catalog"("code") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "plan_versions" DROP CONSTRAINT "plan_versions_plan_code_fkey";
ALTER TABLE "plan_versions" ADD CONSTRAINT "plan_versions_product_code_plan_code_fkey" FOREIGN KEY ("product_code", "plan_code") REFERENCES "plans"("product_code", "code") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "price_versions" ADD CONSTRAINT "price_versions_product_code_fkey" FOREIGN KEY ("product_code") REFERENCES "product_catalog"("code") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "price_versions" DROP CONSTRAINT "price_versions_plan_code_fkey";
ALTER TABLE "price_versions" ADD CONSTRAINT "price_versions_product_code_plan_code_fkey" FOREIGN KEY ("product_code", "plan_code") REFERENCES "plans"("product_code", "code") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_product_code_fkey" FOREIGN KEY ("product_code") REFERENCES "product_catalog"("code") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "subscriptions" DROP CONSTRAINT "subscriptions_plan_version_id_fkey";
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_product_code_plan_version_id_fkey" FOREIGN KEY ("product_code", "plan_version_id") REFERENCES "plan_versions"("product_code", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "billing_subscription_terms" ADD CONSTRAINT "billing_subscription_terms_product_code_fkey" FOREIGN KEY ("product_code") REFERENCES "product_catalog"("code") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "billing_subscription_terms" DROP CONSTRAINT "billing_subscription_terms_subscription_id_fkey";
ALTER TABLE "billing_subscription_terms" ADD CONSTRAINT "billing_subscription_terms_subscription_id_product_code_fkey" FOREIGN KEY ("subscription_id", "product_code") REFERENCES "subscriptions"("id", "product_code") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "organization_module_activations" ADD CONSTRAINT "organization_module_activations_product_code_fkey" FOREIGN KEY ("product_code") REFERENCES "product_catalog"("code") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "organization_entitlements" ADD CONSTRAINT "organization_entitlements_product_code_fkey" FOREIGN KEY ("product_code") REFERENCES "product_catalog"("code") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "organization_quota_usages" ADD CONSTRAINT "organization_quota_usages_product_code_fkey" FOREIGN KEY ("product_code") REFERENCES "product_catalog"("code") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "quota_reservations" ADD CONSTRAINT "quota_reservations_product_code_fkey" FOREIGN KEY ("product_code") REFERENCES "product_catalog"("code") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "quota_ledgers" ADD CONSTRAINT "quota_ledgers_product_code_fkey" FOREIGN KEY ("product_code") REFERENCES "product_catalog"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Enforce that subscription and quota records cannot cross product boundaries.
DROP INDEX "organization_quota_usages_organization_id_quota_code_period_key_key";
ALTER TABLE "organization_quota_usages" ADD CONSTRAINT "organization_quota_usages_org_product_quota_period_key" UNIQUE ("organization_id", "product_code", "quota_code", "period_key");
ALTER TABLE "quota_reservations" DROP CONSTRAINT "quota_reservations_usage_fkey";
ALTER TABLE "quota_reservations" ADD CONSTRAINT "quota_reservations_usage_fkey" FOREIGN KEY ("organization_id", "product_code", "quota_code", "period_key") REFERENCES "organization_quota_usages"("organization_id", "product_code", "quota_code", "period_key") ON DELETE CASCADE ON UPDATE CASCADE;
DROP INDEX "quota_reservations_organization_id_idempotency_key_key";
ALTER TABLE "quota_reservations" ADD CONSTRAINT "quota_reservations_organization_product_idempotency_key" UNIQUE ("organization_id", "product_code", "idempotency_key");
ALTER TABLE "quota_ledgers" DROP CONSTRAINT "quota_ledgers_usage_fkey";
ALTER TABLE "quota_ledgers" ADD CONSTRAINT "quota_ledgers_usage_fkey" FOREIGN KEY ("organization_id", "product_code", "quota_code", "period_key") REFERENCES "organization_quota_usages"("organization_id", "product_code", "quota_code", "period_key") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "quota_ledgers" DROP CONSTRAINT "quota_ledgers_reservation_id_fkey";
ALTER TABLE "quota_ledgers" ADD CONSTRAINT "quota_ledgers_reservation_id_product_code_fkey" FOREIGN KEY ("reservation_id", "product_code") REFERENCES "quota_reservations"("id", "product_code") ON DELETE CASCADE ON UPDATE CASCADE;

-- Product-scoped activations and temporal exclusions allow independent product
-- subscriptions while still preventing same-product overlap under concurrency.
DROP INDEX "organization_module_activations_organization_id_module_code_key";
CREATE UNIQUE INDEX "organization_module_activations_organization_product_module_key" ON "organization_module_activations"("organization_id", "product_code", "module_code");
DROP INDEX "organization_module_activations_organization_id_enabled_idx";
CREATE INDEX "organization_module_activations_organization_product_enabled_idx" ON "organization_module_activations"("organization_id", "product_code", "enabled");
DROP INDEX "subscriptions_organization_id_status_starts_at_ends_at_idx";
CREATE INDEX "subscriptions_organization_product_status_period_idx" ON "subscriptions"("organization_id", "product_code", "status", "starts_at", "ends_at");
DROP INDEX "billing_subscription_terms_organization_id_status_current_p_idx";
CREATE INDEX "billing_subscription_terms_org_product_status_period_idx" ON "billing_subscription_terms"("organization_id", "product_code", "status", "current_period_end");
DROP INDEX "organization_quota_usages_organization_id_period_key_idx";
CREATE INDEX "organization_quota_usages_organization_product_period_idx" ON "organization_quota_usages"("organization_id", "product_code", "period_key");
DROP INDEX "quota_reservations_organization_id_quota_code_period_key_status_idx";
CREATE INDEX "quota_reservations_org_product_quota_period_status_idx" ON "quota_reservations"("organization_id", "product_code", "quota_code", "period_key", "status");
DROP INDEX "quota_ledgers_organization_id_quota_code_period_key_created_at_idx";
CREATE INDEX "quota_ledgers_org_product_quota_period_created_idx" ON "quota_ledgers"("organization_id", "product_code", "quota_code", "period_key", "created_at");
DROP INDEX "organization_entitlements_organization_id_module_code_starts_at_ends_at_idx";
DROP INDEX "organization_entitlements_organization_id_effect_starts_at_ends_at_idx";
CREATE INDEX "organization_entitlements_org_product_module_time_idx" ON "organization_entitlements"("organization_id", "product_code", "module_code", "starts_at", "ends_at");
CREATE INDEX "organization_entitlements_org_product_effect_time_idx" ON "organization_entitlements"("organization_id", "product_code", "effect", "starts_at", "ends_at");

ALTER TABLE "subscriptions" DROP CONSTRAINT "subscriptions_no_overlapping_effective_periods";
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_no_overlapping_effective_periods"
  EXCLUDE USING gist (
    "organization_id" WITH =,
    "product_code" WITH =,
    tstzrange("starts_at", COALESCE("ends_at", 'infinity'::timestamptz), '[)') WITH &&
  )
  WHERE ("status" IN ('TRIALING', 'ACTIVE', 'PAST_DUE', 'SUSPENDED'));

ALTER TABLE "billing_subscription_terms" DROP CONSTRAINT "billing_subscription_terms_no_overlap";
ALTER TABLE "billing_subscription_terms" ADD CONSTRAINT "billing_subscription_terms_no_overlap"
  EXCLUDE USING gist (
    "organization_id" WITH =,
    "product_code" WITH =,
    tstzrange("current_period_start", "current_period_end", '[)') WITH &&
  )
  WHERE ("status" IN ('PENDING', 'ACTIVE', 'PAST_DUE', 'SUSPENDED'));
