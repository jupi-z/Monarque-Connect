-- Phase 7: the inventory ledger is append-only; balances are a transactional projection.
CREATE TYPE "InventoryMovementType" AS ENUM ('RECEIPT_IN', 'SALE_OUT', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT', 'TRANSFER_IN', 'TRANSFER_OUT');
CREATE TYPE "InventoryMovementSourceType" AS ENUM ('MANUAL', 'GOODS_RECEIPT', 'SALE', 'TRANSFER', 'HISTORICAL_IMPORT', 'RECONCILIATION');
ALTER TYPE "AuditAction" ADD VALUE 'INVENTORY_MOVEMENT_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'INVENTORY_TRANSFER_CREATED';

CREATE TABLE "inventory_movements" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "establishment_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "movement_type" "InventoryMovementType" NOT NULL,
    "source_type" "InventoryMovementSourceType" NOT NULL,
    "quantity_delta" DECIMAL(19,6) NOT NULL,
    "source_id" UUID,
    "source_line_id" UUID,
    "transfer_id" UUID,
    "idempotency_key" VARCHAR(200),
    "reason" VARCHAR(500),
    "occurred_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "inventory_movements_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "inventory_movements_quantity_nonzero_check" CHECK ("quantity_delta" <> 0),
    CONSTRAINT "inventory_movements_direction_check" CHECK (
      ("movement_type" IN ('RECEIPT_IN', 'ADJUSTMENT_IN', 'TRANSFER_IN') AND "quantity_delta" > 0)
      OR ("movement_type" IN ('SALE_OUT', 'ADJUSTMENT_OUT', 'TRANSFER_OUT') AND "quantity_delta" < 0)
    )
);

CREATE TABLE "inventory_balances" (
    "organization_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "quantity" DECIMAL(19,6) NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "inventory_balances_pkey" PRIMARY KEY ("organization_id", "warehouse_id", "item_id"),
    CONSTRAINT "inventory_balances_quantity_nonnegative_check" CHECK ("quantity" >= 0)
);

CREATE UNIQUE INDEX "inventory_movements_organization_id_idempotency_key_key" ON "inventory_movements"("organization_id", "idempotency_key");
CREATE UNIQUE INDEX "inventory_movements_source_identity_key" ON "inventory_movements"("organization_id", "source_type", "source_id", "source_line_id", "movement_type") WHERE "source_id" IS NOT NULL AND "source_line_id" IS NOT NULL;
CREATE INDEX "inventory_movements_organization_id_establishment_id_occurred_at_id_idx" ON "inventory_movements"("organization_id", "establishment_id", "occurred_at", "id");
CREATE INDEX "inventory_movements_organization_id_warehouse_id_item_id_occurred_at_id_idx" ON "inventory_movements"("organization_id", "warehouse_id", "item_id", "occurred_at", "id");
CREATE INDEX "inventory_movements_organization_id_source_type_source_id_source_line_id_idx" ON "inventory_movements"("organization_id", "source_type", "source_id", "source_line_id");
CREATE INDEX "inventory_movements_transfer_id_idx" ON "inventory_movements"("transfer_id");
CREATE INDEX "inventory_balances_organization_id_item_id_idx" ON "inventory_balances"("organization_id", "item_id");

ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_establishment_id_organization_id_fkey" FOREIGN KEY ("establishment_id", "organization_id") REFERENCES "establishments"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_warehouse_id_organization_id_fkey" FOREIGN KEY ("warehouse_id", "organization_id") REFERENCES "warehouses"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_item_id_organization_id_fkey" FOREIGN KEY ("item_id", "organization_id") REFERENCES "items"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_balances" ADD CONSTRAINT "inventory_balances_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "inventory_balances" ADD CONSTRAINT "inventory_balances_warehouse_id_organization_id_fkey" FOREIGN KEY ("warehouse_id", "organization_id") REFERENCES "warehouses"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_balances" ADD CONSTRAINT "inventory_balances_item_id_organization_id_fkey" FOREIGN KEY ("item_id", "organization_id") REFERENCES "items"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION "prevent_inventory_movement_mutation"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Tenant deletion cascades are allowed; direct mutation while the tenant exists is not.
  IF EXISTS (SELECT 1 FROM "organizations" WHERE "id" = OLD."organization_id") THEN
    RAISE EXCEPTION 'Inventory movement ledger is append-only';
  END IF;
  RETURN OLD;
END;
$$;

CREATE TRIGGER "inventory_movements_append_only_update"
BEFORE UPDATE OR DELETE ON "inventory_movements"
FOR EACH ROW EXECUTE FUNCTION "prevent_inventory_movement_mutation"();
