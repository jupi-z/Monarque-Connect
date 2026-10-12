ALTER TYPE "AuditAction" ADD VALUE 'BUSINESS_PARTY_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'BUSINESS_PARTY_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE 'BUSINESS_PARTY_STATUS_CHANGED';
ALTER TYPE "AuditAction" ADD VALUE 'CATALOG_ITEM_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'CATALOG_ITEM_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE 'CATALOG_ITEM_STATUS_CHANGED';
ALTER TYPE "AuditAction" ADD VALUE 'WAREHOUSE_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'WAREHOUSE_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE 'WAREHOUSE_STATUS_CHANGED';

CREATE TABLE "business_parties" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "type" VARCHAR(32) NOT NULL,
    "display_name" VARCHAR(160) NOT NULL,
    "email" VARCHAR(320),
    "phone" VARCHAR(40),
    "tax_id" VARCHAR(80),
    "linked_organization_id" UUID,
    "notes" VARCHAR(2000),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "business_parties_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "business_parties_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "business_parties_organization_id_active_display_name_idx" ON "business_parties"("organization_id", "active", "display_name");
CREATE INDEX "business_parties_organization_id_type_active_idx" ON "business_parties"("organization_id", "type", "active");

CREATE TABLE "items" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "type" VARCHAR(16) NOT NULL,
    "sku" VARCHAR(80),
    "name" VARCHAR(160) NOT NULL,
    "description" VARCHAR(2000),
    "unit" VARCHAR(32) NOT NULL,
    "reference_price" DECIMAL(19,4) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "track_inventory" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "items_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "items_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "items_organization_id_active_name_idx" ON "items"("organization_id", "active", "name");
CREATE INDEX "items_organization_id_type_active_idx" ON "items"("organization_id", "type", "active");
CREATE UNIQUE INDEX "items_organization_id_sku_unique" ON "items"("organization_id", "sku") WHERE "sku" IS NOT NULL;

CREATE TABLE "warehouses" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "establishment_id" UUID NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "warehouses_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "warehouses_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "warehouses_establishment_id_organization_id_fkey" FOREIGN KEY ("establishment_id", "organization_id") REFERENCES "establishments"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "warehouses_organization_id_code_key" ON "warehouses"("organization_id", "code");
CREATE UNIQUE INDEX "warehouses_id_organization_id_key" ON "warehouses"("id", "organization_id");
CREATE INDEX "warehouses_organization_id_establishment_id_active_idx" ON "warehouses"("organization_id", "establishment_id", "active");
