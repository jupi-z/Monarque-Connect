-- Add organization-qualified invitation identity for composite scope integrity.
CREATE UNIQUE INDEX "invitations_id_organization_id_key" ON "invitations"("id", "organization_id");

CREATE TABLE "invitation_establishment_scopes" (
    "invitation_id" UUID NOT NULL,
    "establishment_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,

    CONSTRAINT "invitation_establishment_scopes_pkey" PRIMARY KEY ("invitation_id", "establishment_id")
);

CREATE INDEX "invitation_establishment_scopes_organization_id_establishment_id_idx"
ON "invitation_establishment_scopes"("organization_id", "establishment_id");

ALTER TABLE "invitation_establishment_scopes"
ADD CONSTRAINT "invitation_establishment_scopes_invitation_id_organization_fkey"
FOREIGN KEY ("invitation_id", "organization_id") REFERENCES "invitations"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "invitation_establishment_scopes"
ADD CONSTRAINT "invitation_establishment_scopes_establishment_id_organization_fkey"
FOREIGN KEY ("establishment_id", "organization_id") REFERENCES "establishments"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;
