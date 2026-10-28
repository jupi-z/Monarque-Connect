ALTER TYPE "AuditAction" ADD VALUE 'PRICING_TAX_CONTEXT_DRAFT_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'PRICING_TAX_CONTEXT_ACTIVATED';
ALTER TYPE "AuditAction" ADD VALUE 'CATALOG_OFFER_TAX_CLASSIFICATION_CHANGED';

ALTER TABLE "commercial_offers"
  ADD COLUMN "tax_category_code" VARCHAR(64),
  ADD CONSTRAINT "commercial_offers_tax_category_code_check"
    CHECK ("tax_category_code" IS NULL OR "tax_category_code" ~ '^[A-Z][A-Z0-9._-]{0,63}$');

ALTER TABLE "catalog_command_receipts" DROP CONSTRAINT "catalog_command_receipts_resource_type_check";
ALTER TABLE "catalog_command_receipts" ADD CONSTRAINT "catalog_command_receipts_resource_type_check"
  CHECK ("resource_type" IN ('CommercialOffer', 'ItemVariant', 'CommercialPriceVersion', 'PricingPolicyVersion', 'TaxPolicyVersion', 'PricingTaxContextVersion'));

CREATE TABLE "pricing_tax_context_versions" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "product_code" VARCHAR(64) NOT NULL,
  "establishment_id" UUID,
  "version" INTEGER NOT NULL,
  "status" "TaxPolicyStatus" NOT NULL DEFAULT 'DRAFT',
  "jurisdiction_code" VARCHAR(64) NOT NULL,
  "effective_from" TIMESTAMPTZ(6) NOT NULL,
  "created_by_user_id" UUID NOT NULL,
  "activated_by_user_id" UUID,
  "activated_at" TIMESTAMPTZ(6),
  "activation_acknowledgement" VARCHAR(40),
  "command_payload_hash" VARCHAR(64) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "pricing_tax_context_versions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "pricing_tax_context_versions_version_check" CHECK ("version" > 0),
  CONSTRAINT "pricing_tax_context_versions_jurisdiction_check" CHECK ("jurisdiction_code" ~ '^[A-Z0-9][A-Z0-9._:-]{1,63}$'),
  CONSTRAINT "pricing_tax_context_versions_activation_check" CHECK (
    ("status" = 'DRAFT' AND "activated_by_user_id" IS NULL AND "activated_at" IS NULL AND "activation_acknowledgement" IS NULL) OR
    ("status" = 'ACTIVE' AND "activated_by_user_id" IS NOT NULL AND "activated_at" IS NOT NULL AND "activation_acknowledgement" = 'OWNER_REVIEWED_CONFIGURATION')
  ),
  CONSTRAINT "pricing_tax_context_versions_hash_check" CHECK ("command_payload_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "pricing_tax_context_versions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "pricing_tax_context_versions_product_code_fkey" FOREIGN KEY ("product_code") REFERENCES "product_catalog"("code") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "pricing_tax_context_versions_establishment_org_fkey" FOREIGN KEY ("establishment_id", "organization_id") REFERENCES "establishments"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "pricing_tax_context_versions_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "pricing_tax_context_versions_activated_by_user_id_fkey" FOREIGN KEY ("activated_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "pricing_tax_context_versions_id_organization_id_product_code_key"
  ON "pricing_tax_context_versions"("id", "organization_id", "product_code");

CREATE UNIQUE INDEX "pricing_tax_context_default_version_key"
  ON "pricing_tax_context_versions"("organization_id", "product_code", "version") WHERE "establishment_id" IS NULL;
CREATE UNIQUE INDEX "pricing_tax_context_establishment_version_key"
  ON "pricing_tax_context_versions"("organization_id", "product_code", "establishment_id", "version") WHERE "establishment_id" IS NOT NULL;
CREATE UNIQUE INDEX "pricing_tax_context_default_effective_key"
  ON "pricing_tax_context_versions"("organization_id", "product_code", "effective_from") WHERE "establishment_id" IS NULL;
CREATE UNIQUE INDEX "pricing_tax_context_establishment_effective_key"
  ON "pricing_tax_context_versions"("organization_id", "product_code", "establishment_id", "effective_from") WHERE "establishment_id" IS NOT NULL;
CREATE INDEX "pricing_tax_context_resolution_idx"
  ON "pricing_tax_context_versions"("organization_id", "product_code", "establishment_id", "status", "effective_from" DESC);

CREATE FUNCTION "guard_pricing_tax_context_transition"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'pricing tax context versions cannot be deleted' USING ERRCODE = '23514';
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

  RAISE EXCEPTION 'pricing tax context versions are immutable except explicit DRAFT to ACTIVE acknowledgement' USING ERRCODE = '23514';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "pricing_tax_context_versions_transition_guard"
  BEFORE UPDATE OR DELETE ON "pricing_tax_context_versions"
  FOR EACH ROW EXECUTE FUNCTION "guard_pricing_tax_context_transition"();
