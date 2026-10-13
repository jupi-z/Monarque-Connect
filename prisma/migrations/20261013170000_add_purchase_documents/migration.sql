-- Extend the shared transactional numbering counter for Phase 6 documents.
ALTER TYPE "SalesDocumentType" ADD VALUE 'SUPPLIER_RFQ';
ALTER TYPE "SalesDocumentType" ADD VALUE 'PURCHASE_ORDER';
ALTER TYPE "SalesDocumentType" ADD VALUE 'GOODS_RECEIPT';

ALTER TYPE "AuditAction" ADD VALUE 'SUPPLIER_RFQ_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'SUPPLIER_RFQ_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE 'SUPPLIER_RFQ_STATUS_CHANGED';
ALTER TYPE "AuditAction" ADD VALUE 'PURCHASE_ORDER_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'PURCHASE_ORDER_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE 'PURCHASE_ORDER_STATUS_CHANGED';
ALTER TYPE "AuditAction" ADD VALUE 'GOODS_RECEIPT_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'GOODS_RECEIPT_STATUS_CHANGED';
ALTER TYPE "AuditAction" ADD VALUE 'GOODS_RECEIPT_CORRECTED';

CREATE TYPE "SupplierRFQStatus" AS ENUM ('DRAFT', 'SENT', 'CLOSED', 'CANCELLED');
CREATE TYPE "SupplierRFQRecipientStatus" AS ENUM ('PENDING', 'SENT', 'SELECTED', 'DECLINED', 'CANCELLED');
CREATE TYPE "SupplierRecipientKind" AS ENUM ('LOCAL_PARTY', 'NETWORK_ORGANIZATION');
CREATE TYPE "PurchaseOrderStatus" AS ENUM ('DRAFT', 'SENT', 'CONFIRMED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED');
CREATE TYPE "GoodsReceiptStatus" AS ENUM ('DRAFT', 'CONFIRMED', 'CANCELLED');

CREATE TABLE "supplier_rfqs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "establishment_id" UUID NOT NULL,
    "number" VARCHAR(32) NOT NULL,
    "status" "SupplierRFQStatus" NOT NULL DEFAULT 'DRAFT',
    "title" VARCHAR(160) NOT NULL,
    "needed_by" DATE,
    "currency" CHAR(3) NOT NULL,
    "notes" VARCHAR(5000),
    "idempotency_key" VARCHAR(200),
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "supplier_rfqs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "supplier_rfq_lines" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "supplier_rfq_id" UUID NOT NULL,
    "line_index" INTEGER NOT NULL,
    "item_id" UUID,
    "item_name_snapshot" VARCHAR(160) NOT NULL,
    "item_sku_snapshot" VARCHAR(80),
    "description_snapshot" VARCHAR(2000),
    "unit_snapshot" VARCHAR(32) NOT NULL,
    "quantity" DECIMAL(19,6) NOT NULL,
    "requested_by" UUID,
    CONSTRAINT "supplier_rfq_lines_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "supplier_rfq_lines_quantity_positive_check" CHECK ("quantity" > 0)
);

CREATE TABLE "supplier_rfq_recipients" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "supplier_rfq_id" UUID NOT NULL,
    "recipient_kind" "SupplierRecipientKind" NOT NULL,
    "local_party_id" UUID,
    "network_organization_id" UUID,
    "display_name_snapshot" VARCHAR(160) NOT NULL,
    "email_snapshot" VARCHAR(320),
    "phone_snapshot" VARCHAR(40),
    "status" "SupplierRFQRecipientStatus" NOT NULL DEFAULT 'PENDING',
    "sent_at" TIMESTAMPTZ(6),
    "responded_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "supplier_rfq_recipients_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "supplier_rfq_recipients_one_target_check" CHECK (num_nonnulls("local_party_id", "network_organization_id") = 1),
    CONSTRAINT "supplier_rfq_recipients_kind_target_check" CHECK (
      ("recipient_kind" = 'LOCAL_PARTY' AND "local_party_id" IS NOT NULL AND "network_organization_id" IS NULL)
      OR ("recipient_kind" = 'NETWORK_ORGANIZATION' AND "local_party_id" IS NULL AND "network_organization_id" IS NOT NULL)
    ),
    CONSTRAINT "supplier_rfq_recipients_not_self_target_check" CHECK ("network_organization_id" IS NULL OR "network_organization_id" <> "organization_id")
);

CREATE TABLE "purchase_orders" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "establishment_id" UUID NOT NULL,
    "number" VARCHAR(32) NOT NULL,
    "status" "PurchaseOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "supplier_party_id" UUID,
    "supplier_organization_id" UUID,
    "supplier_kind" "SupplierRecipientKind" NOT NULL,
    "supplier_display_name_snapshot" VARCHAR(160) NOT NULL,
    "supplier_email_snapshot" VARCHAR(320),
    "supplier_phone_snapshot" VARCHAR(40),
    "source_rfq_id" UUID,
    "source_rfq_recipient_id" UUID,
    "currency" CHAR(3) NOT NULL,
    "ordered_at" TIMESTAMPTZ(6),
    "notes" VARCHAR(5000),
    "idempotency_key" VARCHAR(200),
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "purchase_orders_one_supplier_target_check" CHECK (num_nonnulls("supplier_party_id", "supplier_organization_id") = 1),
    CONSTRAINT "purchase_orders_supplier_kind_target_check" CHECK (
      ("supplier_kind" = 'LOCAL_PARTY' AND "supplier_party_id" IS NOT NULL AND "supplier_organization_id" IS NULL)
      OR ("supplier_kind" = 'NETWORK_ORGANIZATION' AND "supplier_party_id" IS NULL AND "supplier_organization_id" IS NOT NULL)
    ),
    CONSTRAINT "purchase_orders_not_self_target_check" CHECK ("supplier_organization_id" IS NULL OR "supplier_organization_id" <> "organization_id"),
    CONSTRAINT "purchase_orders_source_pair_check" CHECK (("source_rfq_id" IS NULL) = ("source_rfq_recipient_id" IS NULL))
);

CREATE TABLE "purchase_order_lines" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "purchase_order_id" UUID NOT NULL,
    "line_index" INTEGER NOT NULL,
    "source_rfq_line_id" UUID,
    "source_rfq_id" UUID,
    "item_id" UUID,
    "item_name_snapshot" VARCHAR(160) NOT NULL,
    "item_sku_snapshot" VARCHAR(80),
    "description_snapshot" VARCHAR(2000),
    "unit_snapshot" VARCHAR(32) NOT NULL,
    "quantity_ordered" DECIMAL(19,6) NOT NULL,
    "unit_price" DECIMAL(19,4) NOT NULL,
    "discount_amount" DECIMAL(19,4) NOT NULL,
    "tax_mode" "TaxMode" NOT NULL,
    "tax_code_snapshot" VARCHAR(80),
    "tax_rate" DECIMAL(9,4) NOT NULL,
    "net_amount" DECIMAL(19,4) NOT NULL,
    "tax_amount" DECIMAL(19,4) NOT NULL,
    "gross_amount" DECIMAL(19,4) NOT NULL,
    CONSTRAINT "purchase_order_lines_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "purchase_order_lines_quantity_positive_check" CHECK ("quantity_ordered" > 0),
    CONSTRAINT "purchase_order_lines_source_pair_check" CHECK (("source_rfq_id" IS NULL) = ("source_rfq_line_id" IS NULL))
);

CREATE TABLE "goods_receipts" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "establishment_id" UUID NOT NULL,
    "purchase_order_id" UUID NOT NULL,
    "number" VARCHAR(32) NOT NULL,
    "status" "GoodsReceiptStatus" NOT NULL DEFAULT 'DRAFT',
    "received_at" TIMESTAMPTZ(6) NOT NULL,
    "reference" VARCHAR(160),
    "notes" VARCHAR(5000),
    "idempotency_key" VARCHAR(200),
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "goods_receipts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "goods_receipt_lines" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "goods_receipt_id" UUID NOT NULL,
    "purchase_order_line_id" UUID NOT NULL,
    "line_index" INTEGER NOT NULL,
    "item_id" UUID,
    "item_name_snapshot" VARCHAR(160) NOT NULL,
    "unit_snapshot" VARCHAR(32) NOT NULL,
    "quantity" DECIMAL(19,6) NOT NULL,
    CONSTRAINT "goods_receipt_lines_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "goods_receipt_lines_quantity_positive_check" CHECK ("quantity" > 0)
);

CREATE TABLE "goods_receipt_corrections" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "goods_receipt_id" UUID NOT NULL,
    "reason" VARCHAR(2000) NOT NULL,
    "created_by_user_id" UUID,
    "idempotency_key" VARCHAR(200),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "goods_receipt_corrections_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "goods_receipt_correction_lines" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "correction_id" UUID NOT NULL,
    "goods_receipt_id" UUID NOT NULL,
    "goods_receipt_line_id" UUID NOT NULL,
    "delta_quantity" DECIMAL(19,6) NOT NULL,
    CONSTRAINT "goods_receipt_correction_lines_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "goods_receipt_correction_lines_delta_nonzero_check" CHECK ("delta_quantity" <> 0)
);

CREATE UNIQUE INDEX "supplier_rfqs_organization_id_number_key" ON "supplier_rfqs"("organization_id", "number");
CREATE UNIQUE INDEX "supplier_rfqs_id_organization_id_key" ON "supplier_rfqs"("id", "organization_id");
CREATE UNIQUE INDEX "supplier_rfqs_organization_id_idempotency_key_key" ON "supplier_rfqs"("organization_id", "idempotency_key");
CREATE INDEX "supplier_rfqs_organization_id_establishment_id_status_created_at_id_idx" ON "supplier_rfqs"("organization_id", "establishment_id", "status", "created_at", "id");
CREATE INDEX "supplier_rfqs_organization_id_status_needed_by_idx" ON "supplier_rfqs"("organization_id", "status", "needed_by");

CREATE UNIQUE INDEX "supplier_rfq_lines_supplier_rfq_id_line_index_key" ON "supplier_rfq_lines"("supplier_rfq_id", "line_index");
CREATE UNIQUE INDEX "supplier_rfq_lines_id_organization_id_key" ON "supplier_rfq_lines"("id", "organization_id");
CREATE UNIQUE INDEX "supplier_rfq_lines_supplier_rfq_id_id_organization_id_key" ON "supplier_rfq_lines"("supplier_rfq_id", "id", "organization_id");
CREATE INDEX "supplier_rfq_lines_organization_id_item_id_idx" ON "supplier_rfq_lines"("organization_id", "item_id");

CREATE UNIQUE INDEX "supplier_rfq_recipients_id_organization_id_key" ON "supplier_rfq_recipients"("id", "organization_id");
CREATE UNIQUE INDEX "supplier_rfq_recipients_supplier_rfq_id_id_organization_id_key" ON "supplier_rfq_recipients"("supplier_rfq_id", "id", "organization_id");
CREATE INDEX "supplier_rfq_recipients_organization_id_supplier_rfq_id_status_created_at_id_idx" ON "supplier_rfq_recipients"("organization_id", "supplier_rfq_id", "status", "created_at", "id");
CREATE UNIQUE INDEX "supplier_rfq_recipients_local_target_key" ON "supplier_rfq_recipients"("supplier_rfq_id", "local_party_id") WHERE "local_party_id" IS NOT NULL;
CREATE UNIQUE INDEX "supplier_rfq_recipients_network_target_key" ON "supplier_rfq_recipients"("supplier_rfq_id", "network_organization_id") WHERE "network_organization_id" IS NOT NULL;

CREATE UNIQUE INDEX "purchase_orders_organization_id_number_key" ON "purchase_orders"("organization_id", "number");
CREATE UNIQUE INDEX "purchase_orders_id_organization_id_key" ON "purchase_orders"("id", "organization_id");
CREATE UNIQUE INDEX "purchase_orders_organization_id_idempotency_key_key" ON "purchase_orders"("organization_id", "idempotency_key");
CREATE UNIQUE INDEX "purchase_orders_organization_id_source_rfq_id_source_recipient_id_key" ON "purchase_orders"("organization_id", "source_rfq_id", "source_rfq_recipient_id");
CREATE INDEX "purchase_orders_organization_id_establishment_id_status_created_at_id_idx" ON "purchase_orders"("organization_id", "establishment_id", "status", "created_at", "id");
CREATE INDEX "purchase_orders_organization_id_supplier_party_id_created_at_idx" ON "purchase_orders"("organization_id", "supplier_party_id", "created_at");
CREATE INDEX "purchase_orders_organization_id_supplier_organization_id_created_at_idx" ON "purchase_orders"("organization_id", "supplier_organization_id", "created_at");

CREATE UNIQUE INDEX "purchase_order_lines_purchase_order_id_line_index_key" ON "purchase_order_lines"("purchase_order_id", "line_index");
CREATE UNIQUE INDEX "purchase_order_lines_id_organization_id_key" ON "purchase_order_lines"("id", "organization_id");
CREATE INDEX "purchase_order_lines_organization_id_item_id_idx" ON "purchase_order_lines"("organization_id", "item_id");
CREATE INDEX "purchase_order_lines_organization_id_source_rfq_id_source_rfq_line_id_idx" ON "purchase_order_lines"("organization_id", "source_rfq_id", "source_rfq_line_id");

CREATE UNIQUE INDEX "goods_receipts_organization_id_number_key" ON "goods_receipts"("organization_id", "number");
CREATE UNIQUE INDEX "goods_receipts_id_organization_id_key" ON "goods_receipts"("id", "organization_id");
CREATE UNIQUE INDEX "goods_receipts_organization_id_idempotency_key_key" ON "goods_receipts"("organization_id", "idempotency_key");
CREATE INDEX "goods_receipts_organization_id_establishment_id_status_received_at_id_idx" ON "goods_receipts"("organization_id", "establishment_id", "status", "received_at", "id");
CREATE INDEX "goods_receipts_organization_id_purchase_order_id_received_at_id_idx" ON "goods_receipts"("organization_id", "purchase_order_id", "received_at", "id");

CREATE UNIQUE INDEX "goods_receipt_lines_goods_receipt_id_line_index_key" ON "goods_receipt_lines"("goods_receipt_id", "line_index");
CREATE UNIQUE INDEX "goods_receipt_lines_goods_receipt_id_purchase_order_line_id_key" ON "goods_receipt_lines"("goods_receipt_id", "purchase_order_line_id");
CREATE UNIQUE INDEX "goods_receipt_lines_id_organization_id_key" ON "goods_receipt_lines"("id", "organization_id");
CREATE UNIQUE INDEX "goods_receipt_lines_id_goods_receipt_id_organization_id_key" ON "goods_receipt_lines"("id", "goods_receipt_id", "organization_id");
CREATE INDEX "goods_receipt_lines_organization_id_purchase_order_line_id_idx" ON "goods_receipt_lines"("organization_id", "purchase_order_line_id");

CREATE UNIQUE INDEX "goods_receipt_corrections_id_organization_id_key" ON "goods_receipt_corrections"("id", "organization_id");
CREATE UNIQUE INDEX "goods_receipt_corrections_organization_id_idempotency_key_key" ON "goods_receipt_corrections"("organization_id", "idempotency_key");
CREATE INDEX "goods_receipt_corrections_organization_id_goods_receipt_id_created_at_id_idx" ON "goods_receipt_corrections"("organization_id", "goods_receipt_id", "created_at", "id");

CREATE UNIQUE INDEX "goods_receipt_correction_lines_correction_id_goods_receipt_line_id_key" ON "goods_receipt_correction_lines"("correction_id", "goods_receipt_line_id");
CREATE UNIQUE INDEX "goods_receipt_correction_lines_id_organization_id_key" ON "goods_receipt_correction_lines"("id", "organization_id");
CREATE INDEX "goods_receipt_correction_lines_organization_id_goods_receipt_line_id_idx" ON "goods_receipt_correction_lines"("organization_id", "goods_receipt_line_id");

ALTER TABLE "supplier_rfqs" ADD CONSTRAINT "supplier_rfqs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "supplier_rfqs" ADD CONSTRAINT "supplier_rfqs_establishment_id_organization_id_fkey" FOREIGN KEY ("establishment_id", "organization_id") REFERENCES "establishments"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "supplier_rfq_lines" ADD CONSTRAINT "supplier_rfq_lines_supplier_rfq_id_organization_id_fkey" FOREIGN KEY ("supplier_rfq_id", "organization_id") REFERENCES "supplier_rfqs"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "supplier_rfq_lines" ADD CONSTRAINT "supplier_rfq_lines_item_id_organization_id_fkey" FOREIGN KEY ("item_id", "organization_id") REFERENCES "items"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "supplier_rfq_recipients" ADD CONSTRAINT "supplier_rfq_recipients_supplier_rfq_id_organization_id_fkey" FOREIGN KEY ("supplier_rfq_id", "organization_id") REFERENCES "supplier_rfqs"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "supplier_rfq_recipients" ADD CONSTRAINT "supplier_rfq_recipients_local_party_id_organization_id_fkey" FOREIGN KEY ("local_party_id", "organization_id") REFERENCES "business_parties"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "supplier_rfq_recipients" ADD CONSTRAINT "supplier_rfq_recipients_network_organization_id_fkey" FOREIGN KEY ("network_organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_establishment_id_organization_id_fkey" FOREIGN KEY ("establishment_id", "organization_id") REFERENCES "establishments"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplier_party_id_organization_id_fkey" FOREIGN KEY ("supplier_party_id", "organization_id") REFERENCES "business_parties"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplier_organization_id_fkey" FOREIGN KEY ("supplier_organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_source_rfq_id_organization_id_fkey" FOREIGN KEY ("source_rfq_id", "organization_id") REFERENCES "supplier_rfqs"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_source_rfq_recipient_id_source_rfq_id_organization_id_fkey" FOREIGN KEY ("source_rfq_id", "source_rfq_recipient_id", "organization_id") REFERENCES "supplier_rfq_recipients"("supplier_rfq_id", "id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_purchase_order_id_organization_id_fkey" FOREIGN KEY ("purchase_order_id", "organization_id") REFERENCES "purchase_orders"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_source_rfq_line_id_source_rfq_id_organization_id_fkey" FOREIGN KEY ("source_rfq_id", "source_rfq_line_id", "organization_id") REFERENCES "supplier_rfq_lines"("supplier_rfq_id", "id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_item_id_organization_id_fkey" FOREIGN KEY ("item_id", "organization_id") REFERENCES "items"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_establishment_id_organization_id_fkey" FOREIGN KEY ("establishment_id", "organization_id") REFERENCES "establishments"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_purchase_order_id_organization_id_fkey" FOREIGN KEY ("purchase_order_id", "organization_id") REFERENCES "purchase_orders"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_goods_receipt_id_organization_id_fkey" FOREIGN KEY ("goods_receipt_id", "organization_id") REFERENCES "goods_receipts"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_purchase_order_line_id_organization_id_fkey" FOREIGN KEY ("purchase_order_line_id", "organization_id") REFERENCES "purchase_order_lines"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_item_id_organization_id_fkey" FOREIGN KEY ("item_id", "organization_id") REFERENCES "items"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "goods_receipt_corrections" ADD CONSTRAINT "goods_receipt_corrections_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "goods_receipt_corrections" ADD CONSTRAINT "goods_receipt_corrections_goods_receipt_id_organization_id_fkey" FOREIGN KEY ("goods_receipt_id", "organization_id") REFERENCES "goods_receipts"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "goods_receipt_correction_lines" ADD CONSTRAINT "goods_receipt_correction_lines_correction_id_organization_id_fkey" FOREIGN KEY ("correction_id", "organization_id") REFERENCES "goods_receipt_corrections"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "goods_receipt_correction_lines" ADD CONSTRAINT "goods_receipt_correction_lines_goods_receipt_id_organization_id_fkey" FOREIGN KEY ("goods_receipt_id", "organization_id") REFERENCES "goods_receipts"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "goods_receipt_correction_lines" ADD CONSTRAINT "goods_receipt_correction_lines_goods_receipt_line_id_goods_receipt_id_organization_id_fkey" FOREIGN KEY ("goods_receipt_line_id", "goods_receipt_id", "organization_id") REFERENCES "goods_receipt_lines"("id", "goods_receipt_id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
