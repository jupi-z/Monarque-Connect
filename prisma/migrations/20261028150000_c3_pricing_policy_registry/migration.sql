ALTER TYPE "AuditAction" ADD VALUE 'PRICING_POLICY_VERSION_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'PRICING_TAX_POLICY_DRAFT_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'PRICING_TAX_POLICY_ACTIVATED';

CREATE TYPE "TaxPolicyStatus" AS ENUM ('DRAFT', 'ACTIVE');
CREATE TYPE "TaxCalculationCurrency" AS ENUM ('SOURCE', 'TARGET');

ALTER TABLE "catalog_command_receipts" DROP CONSTRAINT "catalog_command_receipts_resource_type_check";
ALTER TABLE "catalog_command_receipts" ADD CONSTRAINT "catalog_command_receipts_resource_type_check"
  CHECK ("resource_type" IN ('CommercialOffer', 'ItemVariant', 'CommercialPriceVersion', 'PricingPolicyVersion', 'TaxPolicyVersion'));

CREATE TABLE "pricing_policy_versions" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "product_code" VARCHAR(64) NOT NULL,
  "code" VARCHAR(64) NOT NULL,
  "version" INTEGER NOT NULL,
  "effective_from" TIMESTAMPTZ(6) NOT NULL,
  "rounding_mode" VARCHAR(16) NOT NULL,
  "calculation_scale" INTEGER NOT NULL DEFAULT 18,
  "max_fx_age_seconds" INTEGER NOT NULL,
  "allowed_currencies" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "allowed_fx_sources" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "discount_rule_codes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "tax_policy_codes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "created_by_user_id" UUID NOT NULL,
  "command_payload_hash" VARCHAR(64) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "pricing_policy_versions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "pricing_policy_versions_code_check" CHECK ("code" ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  CONSTRAINT "pricing_policy_versions_version_check" CHECK ("version" > 0),
  CONSTRAINT "pricing_policy_versions_rounding_mode_check" CHECK ("rounding_mode" = 'HALF_UP'),
  CONSTRAINT "pricing_policy_versions_calculation_scale_check" CHECK ("calculation_scale" BETWEEN 1 AND 24),
  CONSTRAINT "pricing_policy_versions_fx_age_check" CHECK ("max_fx_age_seconds" BETWEEN 1 AND 2592000),
  CONSTRAINT "pricing_policy_versions_arrays_check" CHECK (
    array_position("allowed_currencies", NULL) IS NULL AND
    array_position("allowed_fx_sources", NULL) IS NULL AND
    array_position("discount_rule_codes", NULL) IS NULL AND
    array_position("tax_policy_codes", NULL) IS NULL
  ),
  CONSTRAINT "pricing_policy_versions_hash_check" CHECK ("command_payload_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "pricing_policy_versions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "pricing_policy_versions_product_code_fkey" FOREIGN KEY ("product_code") REFERENCES "product_catalog"("code") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "pricing_policy_versions_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "pricing_policy_versions_scope_code_version_key" ON "pricing_policy_versions"("organization_id", "product_code", "code", "version");
CREATE INDEX "pricing_policy_versions_scope_effective_idx" ON "pricing_policy_versions"("organization_id", "product_code", "code", "effective_from" DESC);

CREATE TABLE "tax_policy_versions" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "product_code" VARCHAR(64) NOT NULL,
  "code" VARCHAR(64) NOT NULL,
  "version" INTEGER NOT NULL,
  "status" "TaxPolicyStatus" NOT NULL DEFAULT 'DRAFT',
  "jurisdiction_code" VARCHAR(64) NOT NULL,
  "tax_category_code" VARCHAR(64) NOT NULL,
  "rate" DECIMAL(24,18) NOT NULL,
  "calculation_currency" "TaxCalculationCurrency" NOT NULL,
  "effective_from" TIMESTAMPTZ(6) NOT NULL,
  "configuration_reference" VARCHAR(512) NOT NULL,
  "created_by_user_id" UUID NOT NULL,
  "activated_by_user_id" UUID,
  "activated_at" TIMESTAMPTZ(6),
  "activation_acknowledgement" VARCHAR(40),
  "command_payload_hash" VARCHAR(64) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "tax_policy_versions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "tax_policy_versions_code_check" CHECK ("code" ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  CONSTRAINT "tax_policy_versions_version_check" CHECK ("version" > 0),
  CONSTRAINT "tax_policy_versions_jurisdiction_check" CHECK (length(btrim("jurisdiction_code")) BETWEEN 2 AND 64),
  CONSTRAINT "tax_policy_versions_category_check" CHECK ("tax_category_code" ~ '^[A-Z][A-Z0-9._-]{0,63}$'),
  CONSTRAINT "tax_policy_versions_rate_check" CHECK ("rate" >= 0 AND "rate"::text NOT IN ('NaN', 'Infinity', '-Infinity')),
  CONSTRAINT "tax_policy_versions_configuration_reference_check" CHECK (length(btrim("configuration_reference")) BETWEEN 1 AND 512),
  CONSTRAINT "tax_policy_versions_activation_check" CHECK (
    ("status" = 'DRAFT' AND "activated_by_user_id" IS NULL AND "activated_at" IS NULL AND "activation_acknowledgement" IS NULL) OR
    ("status" = 'ACTIVE' AND "activated_by_user_id" IS NOT NULL AND "activated_at" IS NOT NULL AND "activation_acknowledgement" = 'OWNER_REVIEWED_CONFIGURATION')
  ),
  CONSTRAINT "tax_policy_versions_hash_check" CHECK ("command_payload_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "tax_policy_versions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "tax_policy_versions_product_code_fkey" FOREIGN KEY ("product_code") REFERENCES "product_catalog"("code") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "tax_policy_versions_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "tax_policy_versions_activated_by_user_id_fkey" FOREIGN KEY ("activated_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "tax_policy_versions_scope_code_version_key" ON "tax_policy_versions"("organization_id", "product_code", "code", "version");
CREATE INDEX "tax_policy_versions_resolution_idx" ON "tax_policy_versions"("organization_id", "product_code", "jurisdiction_code", "tax_category_code", "status", "effective_from" DESC);

CREATE FUNCTION "reject_pricing_policy_version_mutation"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'pricing policy versions are immutable' USING ERRCODE = '23514';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "pricing_policy_versions_immutable"
  BEFORE UPDATE OR DELETE ON "pricing_policy_versions"
  FOR EACH ROW EXECUTE FUNCTION "reject_pricing_policy_version_mutation"();

CREATE FUNCTION "guard_tax_policy_version_transition"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'tax policy versions cannot be deleted' USING ERRCODE = '23514';
  END IF;

  IF OLD."status" = 'DRAFT'
    AND NEW."status" = 'ACTIVE'
    AND NEW."activated_by_user_id" IS NOT NULL
    AND NEW."activated_at" IS NOT NULL
    AND NEW."activation_acknowledgement" = 'OWNER_REVIEWED_CONFIGURATION'
    AND (to_jsonb(OLD) - ARRAY['status', 'activated_by_user_id', 'activated_at', 'activation_acknowledgement'])
      = (to_jsonb(NEW) - ARRAY['status', 'activated_by_user_id', 'activated_at', 'activation_acknowledgement']) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'tax policy versions are immutable except explicit DRAFT to ACTIVE acknowledgement' USING ERRCODE = '23514';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "tax_policy_versions_transition_guard"
  BEFORE UPDATE OR DELETE ON "tax_policy_versions"
  FOR EACH ROW EXECUTE FUNCTION "guard_tax_policy_version_transition"();
