CREATE TYPE "EntitlementEffect" AS ENUM ('ALLOW', 'DENY', 'LIMIT_OVERRIDE');

ALTER TYPE "AuditAction" ADD VALUE 'ENTITLEMENT_OVERRIDE_SET';

CREATE TABLE "module_business_type_presets" (
    "business_type_code" VARCHAR(64) NOT NULL,
    "module_code" VARCHAR(64) NOT NULL,
    "recommended" BOOLEAN NOT NULL DEFAULT true,
    "default_enabled" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "module_business_type_presets_pkey" PRIMARY KEY ("business_type_code", "module_code")
);

CREATE INDEX "module_business_type_presets_module_code_idx"
  ON "module_business_type_presets"("module_code");

CREATE TABLE "organization_entitlements" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "module_code" VARCHAR(64) NOT NULL,
    "effect" "EntitlementEffect" NOT NULL,
    "starts_at" TIMESTAMPTZ(6) NOT NULL,
    "ends_at" TIMESTAMPTZ(6),
    "reason" VARCHAR(500) NOT NULL,
    "limits_json" JSONB NOT NULL DEFAULT '{}',
    "created_by_actor" VARCHAR(160) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "organization_entitlements_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "organization_entitlements_dates_check" CHECK ("ends_at" IS NULL OR "ends_at" > "starts_at")
);

CREATE INDEX "organization_entitlements_organization_id_module_code_starts_at_ends_at_idx"
  ON "organization_entitlements"("organization_id", "module_code", "starts_at", "ends_at");
CREATE INDEX "organization_entitlements_organization_id_effect_starts_at_ends_at_idx"
  ON "organization_entitlements"("organization_id", "effect", "starts_at", "ends_at");

ALTER TABLE "module_business_type_presets"
  ADD CONSTRAINT "module_business_type_presets_business_type_code_fkey"
  FOREIGN KEY ("business_type_code") REFERENCES "business_types"("code") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "module_business_type_presets"
  ADD CONSTRAINT "module_business_type_presets_module_code_fkey"
  FOREIGN KEY ("module_code") REFERENCES "module_catalog"("code") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "organization_entitlements"
  ADD CONSTRAINT "organization_entitlements_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "organization_entitlements"
  ADD CONSTRAINT "organization_entitlements_module_code_fkey"
  FOREIGN KEY ("module_code") REFERENCES "module_catalog"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "subscriptions"
  ADD CONSTRAINT "subscriptions_no_overlapping_effective_periods"
  EXCLUDE USING gist (
    "organization_id" WITH =,
    tstzrange("starts_at", COALESCE("ends_at", 'infinity'::timestamptz), '[)') WITH &&
  )
  WHERE ("status" IN ('TRIALING', 'ACTIVE', 'PAST_DUE', 'SUSPENDED'));
