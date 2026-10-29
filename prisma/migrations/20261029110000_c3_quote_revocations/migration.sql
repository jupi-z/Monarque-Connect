ALTER TYPE "AuditAction" ADD VALUE 'PRICING_QUOTE_REVOKED';

ALTER TABLE "catalog_command_receipts" DROP CONSTRAINT "catalog_command_receipts_resource_type_check";
ALTER TABLE "catalog_command_receipts" ADD CONSTRAINT "catalog_command_receipts_resource_type_check"
  CHECK ("resource_type" IN ('CommercialOffer', 'ItemVariant', 'CommercialPriceVersion', 'PricingPolicyVersion', 'TaxPolicyVersion', 'PricingTaxContextVersion', 'CommercialDiscountRuleVersion', 'PricingQuoteRevocation'));

CREATE TABLE "pricing_quote_revocations" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "quote_id" UUID NOT NULL,
  "actor_user_id" UUID NOT NULL,
  "reason_code" VARCHAR(40) NOT NULL,
  "command_payload_hash" VARCHAR(64) NOT NULL,
  "revoked_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "pricing_quote_revocations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "pricing_quote_revocations_reason_check" CHECK ("reason_code" IN ('CUSTOMER_REQUEST', 'PRICE_CONFIGURATION_ERROR', 'QUOTE_CREATED_IN_ERROR', 'SECURITY_REVIEW', 'OTHER')),
  CONSTRAINT "pricing_quote_revocations_payload_hash_check" CHECK ("command_payload_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "pricing_quote_revocations_org_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "pricing_quote_revocations_quote_scope_fkey" FOREIGN KEY ("quote_id", "organization_id") REFERENCES "pricing_quotes"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "pricing_quote_revocations_actor_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "pricing_quote_revocations_quote_scope_key" ON "pricing_quote_revocations"("quote_id", "organization_id");
CREATE INDEX "pricing_quote_revocations_org_revoked_idx" ON "pricing_quote_revocations"("organization_id", "revoked_at" DESC);

CREATE TRIGGER "pricing_quote_revocations_immutable"
  BEFORE UPDATE OR DELETE ON "pricing_quote_revocations"
  FOR EACH ROW EXECUTE FUNCTION "reject_pricing_quote_snapshot_mutation"();
