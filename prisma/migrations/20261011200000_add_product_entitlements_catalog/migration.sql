CREATE TYPE "ModuleAvailability" AS ENUM ('MVP', 'BETA', 'FUTURE', 'RETIRED');
CREATE TYPE "PlanVersionStatus" AS ENUM ('DRAFT', 'ACTIVE', 'RETIRED');
CREATE TYPE "BillingPeriod" AS ENUM ('MONTHLY', 'YEARLY');
CREATE TYPE "QuotaUnit" AS ENUM ('COUNT', 'BYTES');

CREATE TABLE "module_catalog" (
    "code" VARCHAR(64) NOT NULL,
    "display_name" VARCHAR(160) NOT NULL,
    "pillar" VARCHAR(80) NOT NULL,
    "description" VARCHAR(500),
    "availability" "ModuleAvailability" NOT NULL DEFAULT 'MVP',
    "is_core" BOOLEAN NOT NULL DEFAULT false,
    "dependencies_json" JSONB NOT NULL DEFAULT '[]'::jsonb,
    "client_metadata_json" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "module_catalog_pkey" PRIMARY KEY ("code")
);

CREATE TABLE "plans" (
    "code" VARCHAR(64) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "description" VARCHAR(500),
    "managed_service" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "plans_pkey" PRIMARY KEY ("code")
);

CREATE TABLE "plan_versions" (
    "id" UUID NOT NULL,
    "plan_code" VARCHAR(64) NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "PlanVersionStatus" NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "billing_period" "BillingPeriod" NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_at" TIMESTAMPTZ(6),
    CONSTRAINT "plan_versions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "plan_versions_plan_code_fkey" FOREIGN KEY ("plan_code") REFERENCES "plans"("code") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "plan_version_modules" (
    "plan_version_id" UUID NOT NULL,
    "module_code" VARCHAR(64) NOT NULL,
    "default_enabled" BOOLEAN NOT NULL DEFAULT true,
    "entitlement_config_json" JSONB NOT NULL DEFAULT '{}'::jsonb,
    CONSTRAINT "plan_version_modules_pkey" PRIMARY KEY ("plan_version_id", "module_code"),
    CONSTRAINT "plan_version_modules_plan_version_id_fkey" FOREIGN KEY ("plan_version_id") REFERENCES "plan_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "plan_version_modules_module_code_fkey" FOREIGN KEY ("module_code") REFERENCES "module_catalog"("code") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "plan_version_quotas" (
    "id" UUID NOT NULL,
    "plan_version_id" UUID NOT NULL,
    "quota_code" VARCHAR(80) NOT NULL,
    "unit" "QuotaUnit" NOT NULL,
    "limit_value" BIGINT NOT NULL,
    CONSTRAINT "plan_version_quotas_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "plan_version_quotas_plan_version_id_fkey" FOREIGN KEY ("plan_version_id") REFERENCES "plan_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "plan_versions_plan_code_version_key" ON "plan_versions"("plan_code", "version");
CREATE INDEX "module_catalog_availability_is_core_idx" ON "module_catalog"("availability", "is_core");
CREATE INDEX "plan_versions_plan_code_status_idx" ON "plan_versions"("plan_code", "status");
CREATE INDEX "plan_version_modules_module_code_idx" ON "plan_version_modules"("module_code");
CREATE UNIQUE INDEX "plan_version_quotas_plan_version_id_quota_code_key" ON "plan_version_quotas"("plan_version_id", "quota_code");

CREATE OR REPLACE FUNCTION prevent_published_plan_version_mutation() RETURNS trigger AS $$
BEGIN
  IF TG_TABLE_NAME = 'plan_versions' THEN
    IF TG_OP = 'DELETE' AND OLD.status = 'ACTIVE' THEN
      RAISE EXCEPTION 'active plan versions are immutable';
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.status = 'ACTIVE' AND (
      NEW.plan_code IS DISTINCT FROM OLD.plan_code OR NEW.version IS DISTINCT FROM OLD.version OR
      NEW.currency IS DISTINCT FROM OLD.currency OR NEW.billing_period IS DISTINCT FROM OLD.billing_period OR
      NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.published_at IS DISTINCT FROM OLD.published_at
    ) THEN
      RAISE EXCEPTION 'active plan versions are immutable';
    END IF;
  ELSE
    IF EXISTS (SELECT 1 FROM plan_versions WHERE id = OLD.plan_version_id AND status = 'ACTIVE') THEN
      RAISE EXCEPTION 'modules and quotas of active plan versions are immutable';
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER plan_versions_immutable_trigger
BEFORE UPDATE OR DELETE ON "plan_versions"
FOR EACH ROW EXECUTE FUNCTION prevent_published_plan_version_mutation();

CREATE TRIGGER plan_version_modules_immutable_trigger
BEFORE UPDATE OR DELETE ON "plan_version_modules"
FOR EACH ROW EXECUTE FUNCTION prevent_published_plan_version_mutation();

CREATE TRIGGER plan_version_quotas_immutable_trigger
BEFORE UPDATE OR DELETE ON "plan_version_quotas"
FOR EACH ROW EXECUTE FUNCTION prevent_published_plan_version_mutation();
