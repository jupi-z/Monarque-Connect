CREATE TYPE "NetworkVerificationStatus" AS ENUM ('UNVERIFIED', 'VERIFIED', 'EXPIRED');

CREATE TABLE "organization_network_trust" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "verification_status" "NetworkVerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "verified_at" TIMESTAMPTZ(6),
    "verification_expires_at" TIMESTAMPTZ(6),
    "published_credentials" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organization_network_trust_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "organization_network_trust_organization_id_key" ON "organization_network_trust"("organization_id");
ALTER TABLE "organization_network_trust" ADD CONSTRAINT "organization_network_trust_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
