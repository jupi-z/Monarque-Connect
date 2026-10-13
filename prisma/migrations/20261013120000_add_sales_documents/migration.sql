-- CreateEnum
CREATE TYPE "SalesDocumentType" AS ENUM ('QUOTE', 'SALES_ORDER', 'INVOICE');

-- CreateEnum
CREATE TYPE "TaxMode" AS ENUM ('EXCLUSIVE', 'INCLUSIVE', 'EXEMPT', 'NOT_APPLICABLE');

-- CreateEnum
CREATE TYPE "QuoteStatus" AS ENUM ('DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SalesOrderStatus" AS ENUM ('DRAFT', 'CONFIRMED', 'CANCELLED', 'FULFILLED');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'PAID', 'VOID');

-- CreateEnum
CREATE TYPE "PaymentRecordStatus" AS ENUM ('RECORDED', 'REVERSED');

-- CreateTable
CREATE TABLE "sales_number_counters" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "document_type" "SalesDocumentType" NOT NULL,
    "year" INTEGER NOT NULL,
    "last_value" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "sales_number_counters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotes" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "establishment_id" UUID NOT NULL,
    "number" VARCHAR(32) NOT NULL,
    "status" "QuoteStatus" NOT NULL DEFAULT 'DRAFT',
    "party_id" UUID,
    "currency" CHAR(3) NOT NULL,
    "valid_until" DATE,
    "total_net" DECIMAL(19,4) NOT NULL,
    "total_tax" DECIMAL(19,4) NOT NULL,
    "total_gross" DECIMAL(19,4) NOT NULL,
    "idempotency_key" VARCHAR(200),
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quote_lines" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "quote_id" UUID NOT NULL,
    "line_index" INTEGER NOT NULL,
    "item_id" UUID,
    "item_name_snapshot" VARCHAR(160) NOT NULL,
    "item_sku_snapshot" VARCHAR(80),
    "description_snapshot" VARCHAR(2000),
    "unit_snapshot" VARCHAR(32) NOT NULL,
    "quantity" DECIMAL(19,6) NOT NULL,
    "unit_price" DECIMAL(19,4) NOT NULL,
    "discount_amount" DECIMAL(19,4) NOT NULL,
    "tax_mode" "TaxMode" NOT NULL,
    "tax_rate" DECIMAL(9,4) NOT NULL,
    "net_amount" DECIMAL(19,4) NOT NULL,
    "tax_amount" DECIMAL(19,4) NOT NULL,
    "gross_amount" DECIMAL(19,4) NOT NULL,

    CONSTRAINT "quote_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_orders" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "establishment_id" UUID NOT NULL,
    "number" VARCHAR(32) NOT NULL,
    "status" "SalesOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "party_id" UUID,
    "source_quote_id" UUID,
    "currency" CHAR(3) NOT NULL,
    "total_net" DECIMAL(19,4) NOT NULL,
    "total_tax" DECIMAL(19,4) NOT NULL,
    "total_gross" DECIMAL(19,4) NOT NULL,
    "idempotency_key" VARCHAR(200),
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "sales_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_order_lines" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "sales_order_id" UUID NOT NULL,
    "line_index" INTEGER NOT NULL,
    "item_id" UUID,
    "item_name_snapshot" VARCHAR(160) NOT NULL,
    "item_sku_snapshot" VARCHAR(80),
    "description_snapshot" VARCHAR(2000),
    "unit_snapshot" VARCHAR(32) NOT NULL,
    "quantity" DECIMAL(19,6) NOT NULL,
    "unit_price" DECIMAL(19,4) NOT NULL,
    "discount_amount" DECIMAL(19,4) NOT NULL,
    "tax_mode" "TaxMode" NOT NULL,
    "tax_rate" DECIMAL(9,4) NOT NULL,
    "net_amount" DECIMAL(19,4) NOT NULL,
    "tax_amount" DECIMAL(19,4) NOT NULL,
    "gross_amount" DECIMAL(19,4) NOT NULL,

    CONSTRAINT "sales_order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "establishment_id" UUID NOT NULL,
    "number" VARCHAR(32) NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "party_id" UUID,
    "source_order_id" UUID,
    "currency" CHAR(3) NOT NULL,
    "issued_at" TIMESTAMPTZ(6),
    "due_at" DATE,
    "total_net" DECIMAL(19,4) NOT NULL,
    "total_tax" DECIMAL(19,4) NOT NULL,
    "total_gross" DECIMAL(19,4) NOT NULL,
    "idempotency_key" VARCHAR(200),
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_lines" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "line_index" INTEGER NOT NULL,
    "item_id" UUID,
    "item_name_snapshot" VARCHAR(160) NOT NULL,
    "item_sku_snapshot" VARCHAR(80),
    "description_snapshot" VARCHAR(2000),
    "unit_snapshot" VARCHAR(32) NOT NULL,
    "quantity" DECIMAL(19,6) NOT NULL,
    "unit_price" DECIMAL(19,4) NOT NULL,
    "discount_amount" DECIMAL(19,4) NOT NULL,
    "tax_mode" "TaxMode" NOT NULL,
    "tax_rate" DECIMAL(9,4) NOT NULL,
    "net_amount" DECIMAL(19,4) NOT NULL,
    "tax_amount" DECIMAL(19,4) NOT NULL,
    "gross_amount" DECIMAL(19,4) NOT NULL,

    CONSTRAINT "invoice_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_records" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "establishment_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "amount" DECIMAL(19,4) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "method_code" VARCHAR(40) NOT NULL,
    "reference" VARCHAR(160),
    "status" "PaymentRecordStatus" NOT NULL DEFAULT 'RECORDED',
    "reversal_of_id" UUID,
    "idempotency_key" VARCHAR(200),
    "recorded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reversed_at" TIMESTAMPTZ(6),
    "recorded_by_user_id" UUID,

    CONSTRAINT "payment_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sales_number_counters_organization_id_document_type_year_idx" ON "sales_number_counters"("organization_id", "document_type", "year");

-- CreateIndex
CREATE UNIQUE INDEX "sales_number_counters_organization_id_document_type_year_key" ON "sales_number_counters"("organization_id", "document_type", "year");

-- CreateIndex
CREATE UNIQUE INDEX "quotes_number_key" ON "quotes"("number");

-- CreateIndex
CREATE INDEX "quotes_organization_id_establishment_id_status_created_at_i_idx" ON "quotes"("organization_id", "establishment_id", "status", "created_at", "id");

-- CreateIndex
CREATE INDEX "quotes_organization_id_party_id_created_at_idx" ON "quotes"("organization_id", "party_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "quotes_id_organization_id_key" ON "quotes"("id", "organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "quotes_organization_id_idempotency_key_key" ON "quotes"("organization_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "quote_lines_organization_id_item_id_idx" ON "quote_lines"("organization_id", "item_id");

-- CreateIndex
CREATE UNIQUE INDEX "quote_lines_quote_id_line_index_key" ON "quote_lines"("quote_id", "line_index");

-- CreateIndex
CREATE UNIQUE INDEX "sales_orders_number_key" ON "sales_orders"("number");

-- CreateIndex
CREATE UNIQUE INDEX "sales_orders_source_quote_id_key" ON "sales_orders"("source_quote_id");

-- CreateIndex
CREATE INDEX "sales_orders_organization_id_establishment_id_status_create_idx" ON "sales_orders"("organization_id", "establishment_id", "status", "created_at", "id");

-- CreateIndex
CREATE INDEX "sales_orders_organization_id_party_id_created_at_idx" ON "sales_orders"("organization_id", "party_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "sales_orders_id_organization_id_key" ON "sales_orders"("id", "organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "sales_orders_organization_id_idempotency_key_key" ON "sales_orders"("organization_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "sales_order_lines_organization_id_item_id_idx" ON "sales_order_lines"("organization_id", "item_id");

-- CreateIndex
CREATE UNIQUE INDEX "sales_order_lines_sales_order_id_line_index_key" ON "sales_order_lines"("sales_order_id", "line_index");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_number_key" ON "invoices"("number");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_source_order_id_key" ON "invoices"("source_order_id");

-- CreateIndex
CREATE INDEX "invoices_organization_id_establishment_id_status_created_at_idx" ON "invoices"("organization_id", "establishment_id", "status", "created_at", "id");

-- CreateIndex
CREATE INDEX "invoices_organization_id_party_id_created_at_idx" ON "invoices"("organization_id", "party_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_id_organization_id_key" ON "invoices"("id", "organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_organization_id_idempotency_key_key" ON "invoices"("organization_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "invoice_lines_organization_id_item_id_idx" ON "invoice_lines"("organization_id", "item_id");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_lines_invoice_id_line_index_key" ON "invoice_lines"("invoice_id", "line_index");

-- CreateIndex
CREATE INDEX "payment_records_organization_id_invoice_id_recorded_at_id_idx" ON "payment_records"("organization_id", "invoice_id", "recorded_at", "id");

-- CreateIndex
CREATE INDEX "payment_records_organization_id_status_idx" ON "payment_records"("organization_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "payment_records_id_organization_id_key" ON "payment_records"("id", "organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_records_organization_id_idempotency_key_key" ON "payment_records"("organization_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "business_parties_id_organization_id_key" ON "business_parties"("id", "organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "items_id_organization_id_key" ON "items"("id", "organization_id");

-- AddForeignKey
ALTER TABLE "sales_number_counters" ADD CONSTRAINT "sales_number_counters_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_establishment_id_organization_id_fkey" FOREIGN KEY ("establishment_id", "organization_id") REFERENCES "establishments"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_party_id_organization_id_fkey" FOREIGN KEY ("party_id", "organization_id") REFERENCES "business_parties"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_lines" ADD CONSTRAINT "quote_lines_quote_id_organization_id_fkey" FOREIGN KEY ("quote_id", "organization_id") REFERENCES "quotes"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_lines" ADD CONSTRAINT "quote_lines_item_id_organization_id_fkey" FOREIGN KEY ("item_id", "organization_id") REFERENCES "items"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_establishment_id_organization_id_fkey" FOREIGN KEY ("establishment_id", "organization_id") REFERENCES "establishments"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_party_id_organization_id_fkey" FOREIGN KEY ("party_id", "organization_id") REFERENCES "business_parties"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_source_quote_id_organization_id_fkey" FOREIGN KEY ("source_quote_id", "organization_id") REFERENCES "quotes"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_order_lines" ADD CONSTRAINT "sales_order_lines_sales_order_id_organization_id_fkey" FOREIGN KEY ("sales_order_id", "organization_id") REFERENCES "sales_orders"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_order_lines" ADD CONSTRAINT "sales_order_lines_item_id_organization_id_fkey" FOREIGN KEY ("item_id", "organization_id") REFERENCES "items"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_establishment_id_organization_id_fkey" FOREIGN KEY ("establishment_id", "organization_id") REFERENCES "establishments"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_party_id_organization_id_fkey" FOREIGN KEY ("party_id", "organization_id") REFERENCES "business_parties"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_source_order_id_organization_id_fkey" FOREIGN KEY ("source_order_id", "organization_id") REFERENCES "sales_orders"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_invoice_id_organization_id_fkey" FOREIGN KEY ("invoice_id", "organization_id") REFERENCES "invoices"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_item_id_organization_id_fkey" FOREIGN KEY ("item_id", "organization_id") REFERENCES "items"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_records" ADD CONSTRAINT "payment_records_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_records" ADD CONSTRAINT "payment_records_establishment_id_organization_id_fkey" FOREIGN KEY ("establishment_id", "organization_id") REFERENCES "establishments"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_records" ADD CONSTRAINT "payment_records_invoice_id_organization_id_fkey" FOREIGN KEY ("invoice_id", "organization_id") REFERENCES "invoices"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_records" ADD CONSTRAINT "payment_records_reversal_of_id_organization_id_fkey" FOREIGN KEY ("reversal_of_id", "organization_id") REFERENCES "payment_records"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
