ALTER TYPE "AuditAction" ADD VALUE 'MODULE_ACTIVATION_CHANGED';

CREATE TABLE "organization_module_activations" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "module_code" VARCHAR(64) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organization_module_activations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "organization_module_activations_organization_id_module_code_key"
  ON "organization_module_activations"("organization_id", "module_code");
CREATE INDEX "organization_module_activations_organization_id_enabled_idx"
  ON "organization_module_activations"("organization_id", "enabled");

ALTER TABLE "organization_module_activations"
  ADD CONSTRAINT "organization_module_activations_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "organization_module_activations"
  ADD CONSTRAINT "organization_module_activations_module_code_fkey"
  FOREIGN KEY ("module_code") REFERENCES "module_catalog"("code") ON DELETE RESTRICT ON UPDATE CASCADE;
