ALTER TYPE "AuditAction" ADD VALUE 'CATALOG_VARIANT_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'CATALOG_OFFER_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'CATALOG_OFFER_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE 'CATALOG_OFFER_STATUS_CHANGED';

CREATE TYPE "CommercialOfferStatus" AS ENUM ('ACTIVE', 'INACTIVE');

CREATE TABLE "measure_units" (
    "code" VARCHAR(32) NOT NULL,
    "display_name" VARCHAR(80) NOT NULL,
    "dimension" VARCHAR(32) NOT NULL,
    "base_unit_code" VARCHAR(32) NOT NULL,
    "numerator" BIGINT NOT NULL,
    "denominator" BIGINT NOT NULL,
    "registry_version" INTEGER NOT NULL,
    "source_revision" VARCHAR(80) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "measure_units_pkey" PRIMARY KEY ("code"),
    CONSTRAINT "measure_units_code_format_check" CHECK ("code" ~ '^[A-Z][A-Z0-9_]{0,31}$'),
    CONSTRAINT "measure_units_dimension_check" CHECK (length(btrim("dimension")) > 0),
    CONSTRAINT "measure_units_factor_check" CHECK ("numerator" > 0 AND "denominator" > 0 AND "numerator" < 1000000000000000000 AND "denominator" < 1000000000000000000),
    CONSTRAINT "measure_units_registry_version_check" CHECK ("registry_version" > 0),
    CONSTRAINT "measure_units_source_revision_check" CHECK (length(btrim("source_revision")) > 0)
);

CREATE INDEX "measure_units_active_dimension_code_idx" ON "measure_units"("active", "dimension", "code");
ALTER TABLE "measure_units" ADD CONSTRAINT "measure_units_base_unit_code_fkey" FOREIGN KEY ("base_unit_code") REFERENCES "measure_units"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "measure_units" ("code", "display_name", "dimension", "base_unit_code", "numerator", "denominator", "registry_version", "source_revision") VALUES
('EA', 'Each', 'COUNT', 'EA', 1, 1, 1, 'monarque-measures-v1'),
('KG', 'Kilogram', 'MASS', 'KG', 1, 1, 1, 'monarque-measures-v1'),
('G', 'Gram', 'MASS', 'KG', 1, 1000, 1, 'monarque-measures-v1'),
('MG', 'Milligram', 'MASS', 'KG', 1, 1000000, 1, 'monarque-measures-v1'),
('L', 'Litre', 'VOLUME', 'L', 1, 1, 1, 'monarque-measures-v1'),
('ML', 'Millilitre', 'VOLUME', 'L', 1, 1000, 1, 'monarque-measures-v1'),
('M', 'Metre', 'LENGTH', 'M', 1, 1, 1, 'monarque-measures-v1'),
('CM', 'Centimetre', 'LENGTH', 'M', 1, 100, 1, 'monarque-measures-v1'),
('MM', 'Millimetre', 'LENGTH', 'M', 1, 1000, 1, 'monarque-measures-v1'),
('HOUR', 'Hour', 'TIME', 'HOUR', 1, 1, 1, 'monarque-measures-v1'),
('MINUTE', 'Minute', 'TIME', 'HOUR', 1, 60, 1, 'monarque-measures-v1');

CREATE TABLE "currency_definitions" (
    "code" CHAR(3) NOT NULL,
    "minor_unit_digits" INTEGER NOT NULL,
    "registry_version" INTEGER NOT NULL,
    "source_revision" VARCHAR(80) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "currency_definitions_pkey" PRIMARY KEY ("code"),
    CONSTRAINT "currency_definitions_code_format_check" CHECK ("code" ~ '^[A-Z]{3}$'),
    CONSTRAINT "currency_definitions_minor_digits_check" CHECK ("minor_unit_digits" BETWEEN 0 AND 4),
    CONSTRAINT "currency_definitions_registry_version_check" CHECK ("registry_version" > 0),
    CONSTRAINT "currency_definitions_source_revision_check" CHECK (length(btrim("source_revision")) > 0)
);

INSERT INTO "currency_definitions" ("code", "minor_unit_digits", "registry_version", "source_revision") VALUES
('CDF', 2, 1, 'six-iso4217-list-one-2026-10'),
('EUR', 2, 1, 'six-iso4217-list-one-2026-10'),
('USD', 2, 1, 'six-iso4217-list-one-2026-10');

CREATE TABLE "item_variants" (
    "id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "code" VARCHAR(80) NOT NULL,
    "display_name" VARCHAR(160) NOT NULL,
    "attributes_json" JSONB NOT NULL DEFAULT '{}',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "item_variants_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "item_variants_code_format_check" CHECK ("code" ~ '^[A-Z0-9][A-Z0-9._-]{0,63}$'),
    CONSTRAINT "item_variants_attributes_object_check" CHECK (jsonb_typeof("attributes_json") = 'object' AND jsonb_array_length(jsonb_path_query_array("attributes_json", '$.keyvalue()')) <= 30)
);

CREATE UNIQUE INDEX "item_variants_item_id_code_key" ON "item_variants"("item_id", "code");
CREATE UNIQUE INDEX "item_variants_id_item_id_organization_id_key" ON "item_variants"("id", "item_id", "organization_id");
CREATE INDEX "item_variants_organization_id_item_id_active_idx" ON "item_variants"("organization_id", "item_id", "active");
ALTER TABLE "item_variants" ADD CONSTRAINT "item_variants_item_id_organization_id_fkey" FOREIGN KEY ("item_id", "organization_id") REFERENCES "items"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "commercial_offers" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "product_code" VARCHAR(64) NOT NULL,
    "item_id" UUID NOT NULL,
    "variant_id" UUID,
    "establishment_id" UUID,
    "channel_code" VARCHAR(48),
    "sell_unit_code" VARCHAR(32) NOT NULL,
    "display_name" VARCHAR(160),
    "status" "CommercialOfferStatus" NOT NULL DEFAULT 'ACTIVE',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "commercial_offers_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "commercial_offers_version_check" CHECK ("version" > 0),
    CONSTRAINT "commercial_offers_channel_code_check" CHECK ("channel_code" IS NULL OR "channel_code" ~ '^[A-Z][A-Z0-9_]{0,47}$'),
    CONSTRAINT "commercial_offers_display_name_check" CHECK ("display_name" IS NULL OR length(btrim("display_name")) > 0)
);

CREATE UNIQUE INDEX "commercial_offers_id_organization_id_key" ON "commercial_offers"("id", "organization_id");
CREATE INDEX "commercial_offers_organization_id_product_code_status_created_at_id_idx" ON "commercial_offers"("organization_id", "product_code", "status", "created_at", "id");
CREATE INDEX "commercial_offers_organization_id_establishment_id_product_code_status_idx" ON "commercial_offers"("organization_id", "establishment_id", "product_code", "status");
ALTER TABLE "commercial_offers" ADD CONSTRAINT "commercial_offers_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "commercial_offers" ADD CONSTRAINT "commercial_offers_product_code_fkey" FOREIGN KEY ("product_code") REFERENCES "product_catalog"("code") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "commercial_offers" ADD CONSTRAINT "commercial_offers_item_id_organization_id_fkey" FOREIGN KEY ("item_id", "organization_id") REFERENCES "items"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "commercial_offers" ADD CONSTRAINT "commercial_offers_variant_id_item_id_organization_id_fkey" FOREIGN KEY ("variant_id", "item_id", "organization_id") REFERENCES "item_variants"("id", "item_id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "commercial_offers" ADD CONSTRAINT "commercial_offers_establishment_id_organization_id_fkey" FOREIGN KEY ("establishment_id", "organization_id") REFERENCES "establishments"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "commercial_offers" ADD CONSTRAINT "commercial_offers_sell_unit_code_fkey" FOREIGN KEY ("sell_unit_code") REFERENCES "measure_units"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "catalog_command_receipts" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "actor_user_id" UUID NOT NULL,
    "operation" VARCHAR(80) NOT NULL,
    "idempotency_key" VARCHAR(200) NOT NULL,
    "payload_hash" VARCHAR(64) NOT NULL,
    "resource_type" VARCHAR(40) NOT NULL,
    "resource_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "catalog_command_receipts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "catalog_command_receipts_payload_hash_check" CHECK ("payload_hash" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "catalog_command_receipts_resource_type_check" CHECK ("resource_type" IN ('CommercialOffer', 'ItemVariant', 'CommercialPriceVersion')),
    CONSTRAINT "catalog_command_receipts_operation_check" CHECK (length(btrim("operation")) > 0 AND length(btrim("idempotency_key")) > 0)
);

CREATE UNIQUE INDEX "catalog_command_receipts_organization_id_actor_user_id_operation_idempotency_key_key" ON "catalog_command_receipts"("organization_id", "actor_user_id", "operation", "idempotency_key");
CREATE INDEX "catalog_command_receipts_organization_id_created_at_idx" ON "catalog_command_receipts"("organization_id", "created_at");
ALTER TABLE "catalog_command_receipts" ADD CONSTRAINT "catalog_command_receipts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "catalog_command_receipts" ADD CONSTRAINT "catalog_command_receipts_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
