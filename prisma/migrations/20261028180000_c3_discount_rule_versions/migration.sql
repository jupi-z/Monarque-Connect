ALTER TYPE "AuditAction" ADD VALUE 'PRICING_DISCOUNT_RULE_VERSION_CREATED';

ALTER TABLE "catalog_command_receipts" DROP CONSTRAINT "catalog_command_receipts_resource_type_check";
ALTER TABLE "catalog_command_receipts" ADD CONSTRAINT "catalog_command_receipts_resource_type_check"
  CHECK ("resource_type" IN ('CommercialOffer', 'ItemVariant', 'CommercialPriceVersion', 'PricingPolicyVersion', 'TaxPolicyVersion', 'PricingTaxContextVersion', 'CommercialDiscountRuleVersion'));

CREATE TABLE "commercial_discount_rule_versions" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "product_code" VARCHAR(64) NOT NULL,
  "code" VARCHAR(64) NOT NULL,
  "version" INTEGER NOT NULL,
  "rate" DECIMAL(24,18) NOT NULL,
  "effective_from" TIMESTAMPTZ(6) NOT NULL,
  "configuration_reference" VARCHAR(512) NOT NULL,
  "created_by_user_id" UUID NOT NULL,
  "command_payload_hash" VARCHAR(64) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "commercial_discount_rule_versions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "commercial_discount_rule_versions_scope_code_version_key" UNIQUE ("organization_id", "product_code", "code", "version"),
  CONSTRAINT "commercial_discount_rule_versions_scope_code_effective_key" UNIQUE ("organization_id", "product_code", "code", "effective_from"),
  CONSTRAINT "commercial_discount_rule_versions_id_scope_key" UNIQUE ("id", "organization_id", "product_code"),
  CONSTRAINT "commercial_discount_rule_versions_code_check" CHECK ("code" ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  CONSTRAINT "commercial_discount_rule_versions_version_check" CHECK ("version" > 0),
  CONSTRAINT "commercial_discount_rule_versions_rate_check" CHECK ("rate" >= 0 AND "rate" <= 100),
  CONSTRAINT "commercial_discount_rule_versions_configuration_reference_check" CHECK (length(btrim("configuration_reference")) BETWEEN 1 AND 512),
  CONSTRAINT "commercial_discount_rule_versions_payload_hash_check" CHECK ("command_payload_hash" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "commercial_discount_rule_versions_organization_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "commercial_discount_rule_versions_product_fkey" FOREIGN KEY ("product_code") REFERENCES "product_catalog"("code") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "commercial_discount_rule_versions_created_by_user_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "commercial_discount_rule_versions_resolution_idx"
  ON "commercial_discount_rule_versions"("organization_id", "product_code", "code", "effective_from" DESC);

CREATE FUNCTION "reject_commercial_discount_rule_version_mutation"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'commercial discount rule versions are immutable' USING ERRCODE = '23514';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "commercial_discount_rule_versions_immutable"
  BEFORE UPDATE OR DELETE ON "commercial_discount_rule_versions"
  FOR EACH ROW EXECUTE FUNCTION "reject_commercial_discount_rule_version_mutation"();
