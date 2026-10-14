-- Phase 7 corrective hardening: persist reconciliation results so the
-- read-only comparison is auditable and idempotent without changing ledgers.
ALTER TYPE "AuditAction" ADD VALUE 'INVENTORY_BALANCE_RECONCILED';

CREATE TABLE "inventory_reconciliations" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "establishment_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "ledger_quantity" DECIMAL(19,6) NOT NULL,
    "observed_quantity" DECIMAL(19,6) NOT NULL,
    "delta" DECIMAL(19,6) NOT NULL,
    "matched" BOOLEAN NOT NULL,
    "idempotency_key" VARCHAR(200) NOT NULL,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "inventory_reconciliations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "inventory_reconciliations_organization_id_idempotency_key_key"
ON "inventory_reconciliations"("organization_id", "idempotency_key");
CREATE UNIQUE INDEX "inventory_reconciliations_id_organization_id_key"
ON "inventory_reconciliations"("id", "organization_id");
CREATE INDEX "inventory_reconciliations_organization_id_establishment_id_warehouse_id_item_id_created_at_id_idx"
ON "inventory_reconciliations"("organization_id", "establishment_id", "warehouse_id", "item_id", "created_at", "id");

ALTER TABLE "inventory_reconciliations"
ADD CONSTRAINT "inventory_reconciliations_organization_id_fkey"
FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "inventory_reconciliations"
ADD CONSTRAINT "inventory_reconciliations_establishment_id_organization_id_fkey"
FOREIGN KEY ("establishment_id", "organization_id") REFERENCES "establishments"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_reconciliations"
ADD CONSTRAINT "inventory_reconciliations_warehouse_id_organization_id_fkey"
FOREIGN KEY ("warehouse_id", "organization_id") REFERENCES "warehouses"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_reconciliations"
ADD CONSTRAINT "inventory_reconciliations_item_id_organization_id_fkey"
FOREIGN KEY ("item_id", "organization_id") REFERENCES "items"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
