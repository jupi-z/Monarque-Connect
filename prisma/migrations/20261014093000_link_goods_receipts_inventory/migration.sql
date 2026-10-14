-- Phase 7 Task 3: preserve GoodsReceipt facts while projecting them into the
-- authoritative Inventory ledger. A receipt is assigned once; every source
-- revision/line can produce at most one immutable movement.
CREATE TYPE "GoodsReceiptInventoryLinkStatus" AS ENUM ('PENDING_ASSIGNMENT', 'ASSIGNED', 'IMPORTED');
CREATE TYPE "GoodsReceiptInventoryDecisionSource" AS ENUM ('EVENT_ASSIGNMENT', 'HISTORICAL_IMPORT');
ALTER TYPE "AuditAction" ADD VALUE 'GOODS_RECEIPT_INVENTORY_ASSIGNED';
ALTER TYPE "AuditAction" ADD VALUE 'GOODS_RECEIPT_INVENTORY_IMPORTED';

ALTER TABLE "inventory_movements" ADD COLUMN "source_revision" VARCHAR(80);

CREATE TABLE "goods_receipt_inventory_links" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "establishment_id" UUID NOT NULL,
    "goods_receipt_id" UUID NOT NULL,
    "warehouse_id" UUID,
    "status" "GoodsReceiptInventoryLinkStatus" NOT NULL DEFAULT 'PENDING_ASSIGNMENT',
    "source_revision" VARCHAR(80) NOT NULL,
    "decision_source" "GoodsReceiptInventoryDecisionSource" NOT NULL,
    "reason" VARCHAR(2000) NOT NULL,
    "idempotency_key" VARCHAR(200),
    "assigned_by_user_id" UUID,
    "assigned_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "goods_receipt_inventory_links_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "goods_receipt_inventory_entries" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "link_id" UUID NOT NULL,
    "goods_receipt_id" UUID NOT NULL,
    "goods_receipt_line_id" UUID NOT NULL,
    "item_id" UUID,
    "source_event_id" UUID,
    "source_revision" VARCHAR(80) NOT NULL,
    "delta_quantity" DECIMAL(19,6) NOT NULL,
    "inventory_movement_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "goods_receipt_inventory_entries_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "goods_receipt_inventory_entries_delta_nonzero_check" CHECK ("delta_quantity" <> 0)
);

DROP INDEX "inventory_movements_source_identity_key";
CREATE UNIQUE INDEX "inventory_movements_source_identity_key" ON "inventory_movements"("organization_id", "source_type", "source_id", "source_line_id", "source_revision", "movement_type") WHERE "source_id" IS NOT NULL AND "source_line_id" IS NOT NULL;
CREATE INDEX "inventory_movements_source_revision_idx" ON "inventory_movements"("organization_id", "source_type", "source_id", "source_line_id", "source_revision");
CREATE UNIQUE INDEX "goods_receipt_inventory_links_goods_receipt_id_organization_id_key" ON "goods_receipt_inventory_links"("goods_receipt_id", "organization_id");
CREATE UNIQUE INDEX "goods_receipt_inventory_links_organization_id_idempotency_key_key" ON "goods_receipt_inventory_links"("organization_id", "idempotency_key");
CREATE UNIQUE INDEX "goods_receipt_inventory_links_id_organization_id_key" ON "goods_receipt_inventory_links"("id", "organization_id");
CREATE INDEX "goods_receipt_inventory_links_organization_id_establishment_id_status_created_at_id_idx" ON "goods_receipt_inventory_links"("organization_id", "establishment_id", "status", "created_at", "id");
CREATE UNIQUE INDEX "goods_receipt_inventory_entries_inventory_movement_id_key" ON "goods_receipt_inventory_entries"("inventory_movement_id");
CREATE UNIQUE INDEX "goods_receipt_inventory_entries_organization_id_goods_receipt_line_id_source_revision_key" ON "goods_receipt_inventory_entries"("organization_id", "goods_receipt_line_id", "source_revision");
CREATE INDEX "goods_receipt_inventory_entries_organization_id_goods_receipt_id_created_at_id_idx" ON "goods_receipt_inventory_entries"("organization_id", "goods_receipt_id", "created_at", "id");
CREATE INDEX "goods_receipt_inventory_entries_organization_id_source_event_id_idx" ON "goods_receipt_inventory_entries"("organization_id", "source_event_id");

ALTER TABLE "goods_receipt_inventory_links" ADD CONSTRAINT "goods_receipt_inventory_links_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "goods_receipt_inventory_links" ADD CONSTRAINT "goods_receipt_inventory_links_establishment_id_organization_id_fkey" FOREIGN KEY ("establishment_id", "organization_id") REFERENCES "establishments"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "goods_receipt_inventory_links" ADD CONSTRAINT "goods_receipt_inventory_links_goods_receipt_id_organization_id_fkey" FOREIGN KEY ("goods_receipt_id", "organization_id") REFERENCES "goods_receipts"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "goods_receipt_inventory_links" ADD CONSTRAINT "goods_receipt_inventory_links_warehouse_id_organization_id_fkey" FOREIGN KEY ("warehouse_id", "organization_id") REFERENCES "warehouses"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "goods_receipt_inventory_entries" ADD CONSTRAINT "goods_receipt_inventory_entries_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "goods_receipt_inventory_entries" ADD CONSTRAINT "goods_receipt_inventory_entries_link_id_organization_id_fkey" FOREIGN KEY ("link_id", "organization_id") REFERENCES "goods_receipt_inventory_links"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "goods_receipt_inventory_entries" ADD CONSTRAINT "goods_receipt_inventory_entries_goods_receipt_id_organization_id_fkey" FOREIGN KEY ("goods_receipt_id", "organization_id") REFERENCES "goods_receipts"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "goods_receipt_inventory_entries" ADD CONSTRAINT "goods_receipt_inventory_entries_goods_receipt_line_id_goods_receipt_id_organization_id_fkey" FOREIGN KEY ("goods_receipt_line_id", "goods_receipt_id", "organization_id") REFERENCES "goods_receipt_lines"("id", "goods_receipt_id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "goods_receipt_inventory_entries" ADD CONSTRAINT "goods_receipt_inventory_entries_item_id_organization_id_fkey" FOREIGN KEY ("item_id", "organization_id") REFERENCES "items"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "goods_receipt_inventory_entries" ADD CONSTRAINT "goods_receipt_inventory_entries_inventory_movement_id_fkey" FOREIGN KEY ("inventory_movement_id") REFERENCES "inventory_movements"("id") ON DELETE SET NULL ON UPDATE CASCADE;
