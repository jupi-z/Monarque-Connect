ALTER TYPE "AuditAction" ADD VALUE 'NETWORK_INQUIRY_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'NETWORK_INQUIRY_STATUS_CHANGED';
ALTER TYPE "AuditAction" ADD VALUE 'NETWORK_INQUIRY_CONVERTED';

CREATE TYPE "NetworkInquiryStatus" AS ENUM ('NEW', 'QUALIFIED', 'DISMISSED', 'CONVERTED');
CREATE TYPE "NetworkInquiryPartyType" AS ENUM ('CUSTOMER', 'SUPPLIER', 'BOTH');

CREATE TABLE "network_inquiries" (
    "id" UUID NOT NULL,
    "source_organization_id" UUID NOT NULL,
    "target_organization_id" UUID NOT NULL,
    "status" "NetworkInquiryStatus" NOT NULL DEFAULT 'NEW',
    "subject" VARCHAR(160) NOT NULL,
    "message" VARCHAR(5000) NOT NULL,
    "requested_party_type" "NetworkInquiryPartyType",
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "network_inquiries_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "network_inquiries_source_organization_id_fkey" FOREIGN KEY ("source_organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "network_inquiries_target_organization_id_fkey" FOREIGN KEY ("target_organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "network_inquiries_source_organization_id_status_created_at_id_idx" ON "network_inquiries"("source_organization_id", "status", "created_at", "id");
CREATE INDEX "network_inquiries_target_organization_id_status_created_at_id_idx" ON "network_inquiries"("target_organization_id", "status", "created_at", "id");
CREATE UNIQUE INDEX "leads_network_inquiry_id_key" ON "leads"("network_inquiry_id");
CREATE UNIQUE INDEX "opportunities_network_inquiry_id_key" ON "opportunities"("network_inquiry_id");
ALTER TABLE "leads" ADD CONSTRAINT "leads_network_inquiry_id_fkey" FOREIGN KEY ("network_inquiry_id") REFERENCES "network_inquiries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_network_inquiry_id_fkey" FOREIGN KEY ("network_inquiry_id") REFERENCES "network_inquiries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
