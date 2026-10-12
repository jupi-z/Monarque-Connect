ALTER TYPE "AuditAction" ADD VALUE 'NETWORK_PROFILE_UPDATED';

CREATE TABLE "organization_network_profiles" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "is_public" BOOLEAN NOT NULL DEFAULT false,
    "display_name" VARCHAR(160) NOT NULL,
    "description" VARCHAR(2000),
    "categories" JSONB NOT NULL DEFAULT '[]',
    "public_location" VARCHAR(160),
    "published_item_ids" JSONB NOT NULL DEFAULT '[]',
    "published_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organization_network_profiles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "organization_network_profiles_organization_id_key" ON "organization_network_profiles"("organization_id");
ALTER TABLE "organization_network_profiles" ADD CONSTRAINT "organization_network_profiles_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
