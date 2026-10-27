-- C1.3: make module entitlement ownership explicit per product.
-- Existing Connect modules remain mapped to Connect; shared Core modules are
-- available as shared capabilities to both registered products. No ZAMUREK
-- commercial module is enabled by this migration.
CREATE TABLE "product_modules" (
  "product_code" VARCHAR(64) NOT NULL,
  "module_code" VARCHAR(64) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "product_modules_pkey" PRIMARY KEY ("product_code", "module_code"),
  CONSTRAINT "product_modules_product_code_fkey" FOREIGN KEY ("product_code") REFERENCES "product_catalog"("code") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "product_modules_module_code_fkey" FOREIGN KEY ("module_code") REFERENCES "module_catalog"("code") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "product_modules_module_code_product_code_idx" ON "product_modules"("module_code", "product_code");

INSERT INTO "product_modules" ("product_code", "module_code")
SELECT 'MONARQUE_CONNECT', "code" FROM "module_catalog"
ON CONFLICT DO NOTHING;

INSERT INTO "product_modules" ("product_code", "module_code")
SELECT 'ZAMUREK', "code" FROM "module_catalog" WHERE "is_core" = true
ON CONFLICT DO NOTHING;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "plan_version_modules" AS pvm
    JOIN "plan_versions" AS pv ON pv."id" = pvm."plan_version_id"
    JOIN "module_catalog" AS mc ON mc."code" = pvm."module_code"
    WHERE pv."product_code" = 'ZAMUREK' AND mc."is_core" = false
  ) OR EXISTS (
    SELECT 1 FROM "organization_module_activations" AS activation
    JOIN "module_catalog" AS mc ON mc."code" = activation."module_code"
    WHERE activation."product_code" = 'ZAMUREK' AND mc."is_core" = false
  ) OR EXISTS (
    SELECT 1 FROM "organization_entitlements" AS entitlement
    JOIN "module_catalog" AS mc ON mc."code" = entitlement."module_code"
    WHERE entitlement."product_code" = 'ZAMUREK' AND mc."is_core" = false
  ) THEN
    RAISE EXCEPTION 'C1.3 found ZAMUREK commercial module assignments before product-module scope was approved';
  END IF;
END $$;

ALTER TABLE "plan_version_modules" ADD COLUMN "product_code" VARCHAR(64);
UPDATE "plan_version_modules" AS pvm
SET "product_code" = pv."product_code"
FROM "plan_versions" AS pv
WHERE pv."id" = pvm."plan_version_id";

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "plan_version_modules" WHERE "product_code" IS NULL) THEN
    RAISE EXCEPTION 'C1.3 product scope backfill found plan modules without a parent PlanVersion';
  END IF;
END $$;

ALTER TABLE "plan_version_modules" ALTER COLUMN "product_code" SET NOT NULL;
ALTER TABLE "plan_version_modules" DROP CONSTRAINT "plan_version_modules_plan_version_id_fkey";
ALTER TABLE "plan_version_modules" DROP CONSTRAINT "plan_version_modules_module_code_fkey";
ALTER TABLE "plan_version_modules"
  ADD CONSTRAINT "plan_version_modules_product_version_fkey"
  FOREIGN KEY ("product_code", "plan_version_id")
  REFERENCES "plan_versions"("product_code", "id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "plan_version_modules_product_module_fkey"
  FOREIGN KEY ("product_code", "module_code")
  REFERENCES "product_modules"("product_code", "module_code") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "plan_version_modules_product_module_idx" ON "plan_version_modules"("product_code", "module_code");

ALTER TABLE "organization_module_activations" DROP CONSTRAINT "organization_module_activations_product_code_fkey";
ALTER TABLE "organization_module_activations" DROP CONSTRAINT "organization_module_activations_module_code_fkey";
ALTER TABLE "organization_module_activations"
  ADD CONSTRAINT "organization_module_activations_product_module_fkey"
  FOREIGN KEY ("product_code", "module_code")
  REFERENCES "product_modules"("product_code", "module_code") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "organization_entitlements" DROP CONSTRAINT "organization_entitlements_product_code_fkey";
ALTER TABLE "organization_entitlements" DROP CONSTRAINT "organization_entitlements_module_code_fkey";
ALTER TABLE "organization_entitlements"
  ADD CONSTRAINT "organization_entitlements_product_module_fkey"
  FOREIGN KEY ("product_code", "module_code")
  REFERENCES "product_modules"("product_code", "module_code") ON DELETE RESTRICT ON UPDATE CASCADE;
