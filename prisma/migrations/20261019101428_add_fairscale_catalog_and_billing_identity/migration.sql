-- FairScale V1 Phase 9.5 catalog and billing identity foundation.
-- This migration is intentionally additive and does not alter prior phase tables.

CREATE TYPE "PriceVersionStatus" AS ENUM ('DRAFT', 'ACTIVE', 'RETIRED');
CREATE TYPE "PriceComponentKind" AS ENUM ('BASE_PLAN', 'ESTABLISHMENT_ADDON');
CREATE TYPE "BillingCustomerStatus" AS ENUM ('UNVERIFIED', 'VERIFIED', 'REVIEW_REQUIRED', 'SUSPENDED');
CREATE TYPE "BillingCustomerOrganizationRole" AS ENUM ('OWNER', 'MEMBER');
CREATE TYPE "BillingQuoteStatus" AS ENUM ('ISSUED', 'EXPIRED', 'ACCEPTED', 'CANCELED');
CREATE TYPE "BillingPromotionStatus" AS ENUM ('NONE', 'ELIGIBLE', 'RESERVED', 'CONSUMED', 'RELEASED');

CREATE TABLE "price_versions" (
    "id" UUID NOT NULL,
    "plan_code" VARCHAR(64) NOT NULL,
    "version" INTEGER NOT NULL,
    "billing_period" "BillingPeriod" NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "status" "PriceVersionStatus" NOT NULL,
    "base_amount_minor" BIGINT NOT NULL,
    "welcome_amount_minor" BIGINT NOT NULL,
    "annual_discount_amount_minor" BIGINT NOT NULL DEFAULT 0,
    "included_establishments" INTEGER NOT NULL,
    "starts_at" TIMESTAMPTZ(6) NOT NULL,
    "published_at" TIMESTAMPTZ(6),
    "retired_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "price_versions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "price_components" (
    "id" UUID NOT NULL,
    "price_version_id" UUID NOT NULL,
    "code" VARCHAR(64) NOT NULL,
    "kind" "PriceComponentKind" NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "capacity_units" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "price_components_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "billing_customers" (
    "id" UUID NOT NULL,
    "identity_key" VARCHAR(200),
    "display_name" VARCHAR(200) NOT NULL,
    "status" "BillingCustomerStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "verified_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "billing_customers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "billing_customer_organizations" (
    "billing_customer_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "role" "BillingCustomerOrganizationRole" NOT NULL DEFAULT 'OWNER',
    "evidence_json" JSONB NOT NULL DEFAULT '{}',
    "verified_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "billing_customer_organizations_pkey" PRIMARY KEY ("billing_customer_id","organization_id")
);

CREATE TABLE "billing_quotes" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "billing_customer_id" UUID NOT NULL,
    "price_version_id" UUID NOT NULL,
    "idempotency_key" VARCHAR(200) NOT NULL,
    "status" "BillingQuoteStatus" NOT NULL,
    "plan_code" VARCHAR(64) NOT NULL,
    "billing_period" "BillingPeriod" NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "catalog_version" INTEGER NOT NULL,
    "base_amount_minor" BIGINT NOT NULL,
    "discount_amount_minor" BIGINT NOT NULL,
    "addon_amount_minor" BIGINT NOT NULL,
    "total_amount_minor" BIGINT NOT NULL,
    "active_establishment_count" INTEGER NOT NULL,
    "included_establishments" INTEGER NOT NULL,
    "addon_establishments" INTEGER NOT NULL,
    "promotion_code" VARCHAR(80),
    "promotion_status" "BillingPromotionStatus" NOT NULL DEFAULT 'NONE',
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "billing_quotes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "billing_quote_lines" (
    "id" UUID NOT NULL,
    "quote_id" UUID NOT NULL,
    "code" VARCHAR(64) NOT NULL,
    "description" VARCHAR(240) NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_amount_minor" BIGINT NOT NULL,
    "discount_amount_minor" BIGINT NOT NULL,
    "total_amount_minor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "billing_quote_lines_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "billing_promotion_redemptions" (
    "id" UUID NOT NULL,
    "billing_customer_id" UUID NOT NULL,
    "quote_id" UUID,
    "promotion_code" VARCHAR(80) NOT NULL,
    "billing_period" "BillingPeriod" NOT NULL,
    "sequence" INTEGER NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "status" "BillingPromotionStatus" NOT NULL,
    "reserved_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "consumed_at" TIMESTAMPTZ(6),
    "released_at" TIMESTAMPTZ(6),
    CONSTRAINT "billing_promotion_redemptions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "billing_promotion_eligibilities" (
    "id" UUID NOT NULL,
    "billing_customer_id" UUID NOT NULL,
    "promotion_code" VARCHAR(80) NOT NULL,
    "eligible" BOOLEAN NOT NULL DEFAULT true,
    "monthly_paid_count" INTEGER NOT NULL DEFAULT 0,
    "first_eligible_at" TIMESTAMPTZ(6),
    "locked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "billing_promotion_eligibilities_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "price_versions_plan_code_version_billing_period_key" ON "price_versions"("plan_code", "version", "billing_period");
CREATE INDEX "price_versions_plan_code_status_billing_period_starts_at_idx" ON "price_versions"("plan_code", "status", "billing_period", "starts_at");
CREATE UNIQUE INDEX "price_components_price_version_id_code_key" ON "price_components"("price_version_id", "code");
CREATE INDEX "price_components_code_kind_idx" ON "price_components"("code", "kind");
CREATE UNIQUE INDEX "billing_customers_identity_key_key" ON "billing_customers"("identity_key");
CREATE INDEX "billing_customers_status_created_at_idx" ON "billing_customers"("status", "created_at");
CREATE INDEX "billing_customer_organizations_organization_id_idx" ON "billing_customer_organizations"("organization_id");
CREATE UNIQUE INDEX "billing_quotes_organization_id_idempotency_key_key" ON "billing_quotes"("organization_id", "idempotency_key");
CREATE INDEX "billing_quotes_organization_id_created_at_idx" ON "billing_quotes"("organization_id", "created_at");
CREATE INDEX "billing_quotes_billing_customer_id_created_at_idx" ON "billing_quotes"("billing_customer_id", "created_at");
CREATE INDEX "billing_quote_lines_quote_id_code_idx" ON "billing_quote_lines"("quote_id", "code");
CREATE UNIQUE INDEX "billing_promotion_redemptions_billing_customer_id_promotion_key" ON "billing_promotion_redemptions"("billing_customer_id", "promotion_code", "billing_period", "sequence");
CREATE UNIQUE INDEX "billing_promotion_redemptions_quote_id_promotion_code_key" ON "billing_promotion_redemptions"("quote_id", "promotion_code");
CREATE INDEX "billing_promotion_redemptions_billing_customer_id_promotion_idx" ON "billing_promotion_redemptions"("billing_customer_id", "promotion_code", "status");
CREATE UNIQUE INDEX "billing_promotion_eligibilities_billing_customer_id_promoti_key" ON "billing_promotion_eligibilities"("billing_customer_id", "promotion_code");
CREATE INDEX "billing_promotion_eligibilities_promotion_code_eligible_idx" ON "billing_promotion_eligibilities"("promotion_code", "eligible");

ALTER TABLE "price_versions" ADD CONSTRAINT "price_versions_plan_code_fkey" FOREIGN KEY ("plan_code") REFERENCES "plans"("code") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "price_components" ADD CONSTRAINT "price_components_price_version_id_fkey" FOREIGN KEY ("price_version_id") REFERENCES "price_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "billing_customer_organizations" ADD CONSTRAINT "billing_customer_organizations_billing_customer_id_fkey" FOREIGN KEY ("billing_customer_id") REFERENCES "billing_customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "billing_customer_organizations" ADD CONSTRAINT "billing_customer_organizations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "billing_quotes" ADD CONSTRAINT "billing_quotes_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "billing_quotes" ADD CONSTRAINT "billing_quotes_billing_customer_id_fkey" FOREIGN KEY ("billing_customer_id") REFERENCES "billing_customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "billing_quotes" ADD CONSTRAINT "billing_quotes_price_version_id_fkey" FOREIGN KEY ("price_version_id") REFERENCES "price_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "billing_quote_lines" ADD CONSTRAINT "billing_quote_lines_quote_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "billing_quotes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "billing_promotion_redemptions" ADD CONSTRAINT "billing_promotion_redemptions_billing_customer_id_fkey" FOREIGN KEY ("billing_customer_id") REFERENCES "billing_customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "billing_promotion_redemptions" ADD CONSTRAINT "billing_promotion_redemptions_quote_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "billing_quotes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "billing_promotion_eligibilities" ADD CONSTRAINT "billing_promotion_eligibilities_billing_customer_id_fkey" FOREIGN KEY ("billing_customer_id") REFERENCES "billing_customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
