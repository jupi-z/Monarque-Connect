ALTER TYPE "AuditAction" ADD VALUE 'LEAD_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'LEAD_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE 'LEAD_STATUS_CHANGED';
ALTER TYPE "AuditAction" ADD VALUE 'OPPORTUNITY_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'OPPORTUNITY_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE 'OPPORTUNITY_STATUS_CHANGED';

CREATE TYPE "CrmSource" AS ENUM ('DIRECT', 'NETWORK_INQUIRY');
CREATE TYPE "LeadStatus" AS ENUM ('NEW', 'QUALIFIED', 'CONVERTED', 'DISMISSED');
CREATE TYPE "OpportunityStatus" AS ENUM ('OPEN', 'WON', 'LOST', 'CANCELLED');

CREATE TABLE "leads" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "party_id" UUID,
    "network_inquiry_id" UUID,
    "status" "LeadStatus" NOT NULL DEFAULT 'NEW',
    "source" "CrmSource" NOT NULL DEFAULT 'DIRECT',
    "display_name" VARCHAR(160) NOT NULL,
    "email" VARCHAR(320),
    "phone" VARCHAR(40),
    "notes" VARCHAR(5000),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "leads_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "leads_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "leads_organization_id_status_created_at_id_idx" ON "leads"("organization_id", "status", "created_at", "id");
CREATE INDEX "leads_organization_id_active_created_at_id_idx" ON "leads"("organization_id", "active", "created_at", "id");
CREATE INDEX "leads_organization_id_display_name_idx" ON "leads"("organization_id", "display_name");

CREATE TABLE "opportunities" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "establishment_id" UUID NOT NULL,
    "party_id" UUID,
    "network_inquiry_id" UUID,
    "status" "OpportunityStatus" NOT NULL DEFAULT 'OPEN',
    "source" "CrmSource" NOT NULL DEFAULT 'DIRECT',
    "name" VARCHAR(160) NOT NULL,
    "expected_value" DECIMAL(19,4),
    "currency" CHAR(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "opportunities_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "opportunities_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "opportunities_establishment_id_organization_id_fkey" FOREIGN KEY ("establishment_id", "organization_id") REFERENCES "establishments"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "opportunities_expected_value_non_negative_check" CHECK ("expected_value" IS NULL OR "expected_value" >= 0),
    CONSTRAINT "opportunities_currency_format_check" CHECK ("currency" IS NULL OR "currency" ~ '^[A-Z]{3}$')
);

CREATE INDEX "opportunities_organization_id_establishment_id_status_created_at_id_idx" ON "opportunities"("organization_id", "establishment_id", "status", "created_at", "id");
CREATE INDEX "opportunities_organization_id_active_created_at_id_idx" ON "opportunities"("organization_id", "active", "created_at", "id");
