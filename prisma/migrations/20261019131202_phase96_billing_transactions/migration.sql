-- CreateEnum
CREATE TYPE "BillingTermStatus" AS ENUM ('PENDING', 'ACTIVE', 'PAST_DUE', 'SUSPENDED', 'CANCELED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "BillingCheckoutStatus" AS ENUM ('CREATED', 'PAYMENT_PENDING', 'PAID', 'CANCELED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "BillingInvoiceStatus" AS ENUM ('OPEN', 'PAID', 'VOID', 'UNCOLLECTIBLE');

-- CreateEnum
CREATE TYPE "BillingPaymentAttemptStatus" AS ENUM ('CREATED', 'REQUIRES_ACTION', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'CANCELED');

-- CreateEnum
CREATE TYPE "BillingPaymentStatus" AS ENUM ('SUCCEEDED', 'PARTIALLY_REFUNDED', 'REFUNDED', 'CHARGEBACK');

-- CreateEnum
CREATE TYPE "BillingRefundStatus" AS ENUM ('REQUESTED', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "BillingProviderEventStatus" AS ENUM ('RECEIVED', 'PROCESSED', 'IGNORED', 'FAILED');

-- CreateEnum
CREATE TYPE "BillingScheduledChangeKind" AS ENUM ('PLAN_CHANGE', 'PERIOD_CHANGE', 'ADDON_CHANGE', 'CANCELLATION');

-- CreateEnum
CREATE TYPE "BillingScheduledChangeStatus" AS ENUM ('PENDING', 'APPLIED', 'CANCELED');

-- CreateEnum
CREATE TYPE "BillingAddonStatus" AS ENUM ('ACTIVE', 'SCHEDULED_TO_REMOVE', 'CANCELED');

-- AlterTable
ALTER TABLE "billing_promotion_redemptions" ADD COLUMN     "billing_invoice_id" UUID;

-- CreateTable
CREATE TABLE "billing_subscription_terms" (
    "id" UUID NOT NULL,
    "billing_customer_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "subscription_id" UUID NOT NULL,
    "source_quote_id" UUID,
    "status" "BillingTermStatus" NOT NULL,
    "plan_code" VARCHAR(64) NOT NULL,
    "billing_period" "BillingPeriod" NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "catalog_version" INTEGER NOT NULL,
    "base_amount_minor" BIGINT NOT NULL,
    "discount_amount_minor" BIGINT NOT NULL,
    "addon_amount_minor" BIGINT NOT NULL,
    "total_amount_minor" BIGINT NOT NULL,
    "starts_at" TIMESTAMPTZ(6) NOT NULL,
    "current_period_start" TIMESTAMPTZ(6) NOT NULL,
    "current_period_end" TIMESTAMPTZ(6) NOT NULL,
    "next_renewal_at" TIMESTAMPTZ(6),
    "canceled_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "billing_subscription_terms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing_checkout_orders" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "billing_customer_id" UUID NOT NULL,
    "subscription_term_id" UUID,
    "quote_id" UUID NOT NULL,
    "idempotency_key" VARCHAR(200) NOT NULL,
    "status" "BillingCheckoutStatus" NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "billing_checkout_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing_invoices" (
    "id" UUID NOT NULL,
    "billing_customer_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "subscription_term_id" UUID NOT NULL,
    "checkout_order_id" UUID,
    "number" VARCHAR(40) NOT NULL,
    "sequence" INTEGER NOT NULL,
    "status" "BillingInvoiceStatus" NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "period_start" TIMESTAMPTZ(6) NOT NULL,
    "period_end" TIMESTAMPTZ(6) NOT NULL,
    "subtotal_minor" BIGINT NOT NULL,
    "discount_minor" BIGINT NOT NULL,
    "tax_minor" BIGINT NOT NULL DEFAULT 0,
    "total_minor" BIGINT NOT NULL,
    "amount_paid_minor" BIGINT NOT NULL DEFAULT 0,
    "issued_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "due_at" TIMESTAMPTZ(6) NOT NULL,
    "paid_at" TIMESTAMPTZ(6),
    "voided_at" TIMESTAMPTZ(6),

    CONSTRAINT "billing_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing_invoice_lines" (
    "id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "line_index" INTEGER NOT NULL,
    "code" VARCHAR(64) NOT NULL,
    "description" VARCHAR(240) NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_amount_minor" BIGINT NOT NULL,
    "discount_minor" BIGINT NOT NULL,
    "total_minor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,

    CONSTRAINT "billing_invoice_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing_payment_attempts" (
    "id" UUID NOT NULL,
    "billing_customer_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "subscription_term_id" UUID,
    "checkout_order_id" UUID,
    "invoice_id" UUID,
    "idempotency_key" VARCHAR(200) NOT NULL,
    "provider" VARCHAR(64) NOT NULL,
    "provider_payment_id" VARCHAR(200),
    "status" "BillingPaymentAttemptStatus" NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "failure_code" VARCHAR(120),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "billing_payment_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing_payments" (
    "id" UUID NOT NULL,
    "payment_attempt_id" UUID NOT NULL,
    "billing_customer_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "provider" VARCHAR(64) NOT NULL,
    "external_transaction_id" VARCHAR(200) NOT NULL,
    "status" "BillingPaymentStatus" NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "billing_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing_refunds" (
    "id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "provider_refund_id" VARCHAR(200),
    "amount_minor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "status" "BillingRefundStatus" NOT NULL,
    "reason" VARCHAR(240) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "billing_refunds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing_provider_event_inbox" (
    "id" UUID NOT NULL,
    "provider" VARCHAR(64) NOT NULL,
    "provider_event_id" VARCHAR(200) NOT NULL,
    "organization_id" UUID,
    "billing_customer_id" UUID,
    "event_type" VARCHAR(120) NOT NULL,
    "payload_hash" CHAR(64) NOT NULL,
    "status" "BillingProviderEventStatus" NOT NULL,
    "failure_reason" VARCHAR(240),
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ(6),

    CONSTRAINT "billing_provider_event_inbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing_subscription_addons" (
    "id" UUID NOT NULL,
    "subscription_term_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "code" VARCHAR(64) NOT NULL,
    "status" "BillingAddonStatus" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "billing_period" "BillingPeriod" NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "unit_amount_minor" BIGINT NOT NULL,
    "starts_at" TIMESTAMPTZ(6) NOT NULL,
    "ends_at" TIMESTAMPTZ(6),
    "scheduled_end_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "billing_subscription_addons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing_scheduled_changes" (
    "id" UUID NOT NULL,
    "subscription_term_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "kind" "BillingScheduledChangeKind" NOT NULL,
    "status" "BillingScheduledChangeStatus" NOT NULL,
    "effective_at" TIMESTAMPTZ(6) NOT NULL,
    "target_plan_code" VARCHAR(64),
    "target_billing_period" "BillingPeriod",
    "target_state_json" JSONB NOT NULL DEFAULT '{}',
    "requested_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "applied_at" TIMESTAMPTZ(6),
    "canceled_at" TIMESTAMPTZ(6),

    CONSTRAINT "billing_scheduled_changes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "billing_subscription_terms_subscription_id_key" ON "billing_subscription_terms"("subscription_id");

-- CreateIndex
CREATE UNIQUE INDEX "billing_subscription_terms_source_quote_id_key" ON "billing_subscription_terms"("source_quote_id");

-- CreateIndex
CREATE INDEX "billing_subscription_terms_organization_id_status_current_p_idx" ON "billing_subscription_terms"("organization_id", "status", "current_period_end");

-- CreateIndex
CREATE INDEX "billing_subscription_terms_billing_customer_id_status_curre_idx" ON "billing_subscription_terms"("billing_customer_id", "status", "current_period_end");

-- CreateIndex
CREATE UNIQUE INDEX "billing_checkout_orders_quote_id_key" ON "billing_checkout_orders"("quote_id");

-- CreateIndex
CREATE INDEX "billing_checkout_orders_organization_id_status_created_at_idx" ON "billing_checkout_orders"("organization_id", "status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "billing_checkout_orders_organization_id_idempotency_key_key" ON "billing_checkout_orders"("organization_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "billing_invoices_checkout_order_id_key" ON "billing_invoices"("checkout_order_id");

-- CreateIndex
CREATE UNIQUE INDEX "billing_invoices_number_key" ON "billing_invoices"("number");

-- CreateIndex
CREATE INDEX "billing_invoices_organization_id_status_issued_at_idx" ON "billing_invoices"("organization_id", "status", "issued_at");

-- CreateIndex
CREATE INDEX "billing_invoices_billing_customer_id_status_issued_at_idx" ON "billing_invoices"("billing_customer_id", "status", "issued_at");

-- CreateIndex
CREATE UNIQUE INDEX "billing_invoices_subscription_term_id_sequence_key" ON "billing_invoices"("subscription_term_id", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "billing_invoices_subscription_term_id_period_start_period_e_key" ON "billing_invoices"("subscription_term_id", "period_start", "period_end");

-- CreateIndex
CREATE UNIQUE INDEX "billing_invoice_lines_invoice_id_line_index_key" ON "billing_invoice_lines"("invoice_id", "line_index");

-- CreateIndex
CREATE INDEX "billing_payment_attempts_organization_id_status_created_at_idx" ON "billing_payment_attempts"("organization_id", "status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "billing_payment_attempts_organization_id_idempotency_key_key" ON "billing_payment_attempts"("organization_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "billing_payment_attempts_provider_provider_payment_id_key" ON "billing_payment_attempts"("provider", "provider_payment_id");

-- CreateIndex
CREATE UNIQUE INDEX "billing_payments_payment_attempt_id_key" ON "billing_payments"("payment_attempt_id");

-- CreateIndex
CREATE UNIQUE INDEX "billing_payments_external_transaction_id_key" ON "billing_payments"("external_transaction_id");

-- CreateIndex
CREATE INDEX "billing_payments_organization_id_received_at_idx" ON "billing_payments"("organization_id", "received_at");

-- CreateIndex
CREATE UNIQUE INDEX "billing_refunds_provider_refund_id_key" ON "billing_refunds"("provider_refund_id");

-- CreateIndex
CREATE INDEX "billing_refunds_payment_id_created_at_idx" ON "billing_refunds"("payment_id", "created_at");

-- CreateIndex
CREATE INDEX "billing_provider_event_inbox_status_received_at_idx" ON "billing_provider_event_inbox"("status", "received_at");

-- CreateIndex
CREATE INDEX "billing_provider_event_inbox_organization_id_received_at_idx" ON "billing_provider_event_inbox"("organization_id", "received_at");

-- CreateIndex
CREATE UNIQUE INDEX "billing_provider_event_inbox_provider_provider_event_id_key" ON "billing_provider_event_inbox"("provider", "provider_event_id");

-- CreateIndex
CREATE INDEX "billing_subscription_addons_organization_id_status_starts_a_idx" ON "billing_subscription_addons"("organization_id", "status", "starts_at");

-- CreateIndex
CREATE UNIQUE INDEX "billing_subscription_addons_subscription_term_id_code_start_key" ON "billing_subscription_addons"("subscription_term_id", "code", "starts_at");

-- CreateIndex
CREATE INDEX "billing_scheduled_changes_organization_id_status_effective__idx" ON "billing_scheduled_changes"("organization_id", "status", "effective_at");

-- CreateIndex
CREATE INDEX "billing_scheduled_changes_subscription_term_id_kind_status_idx" ON "billing_scheduled_changes"("subscription_term_id", "kind", "status");

-- CreateIndex
CREATE INDEX "billing_promotion_redemptions_billing_invoice_id_idx" ON "billing_promotion_redemptions"("billing_invoice_id");

-- AddForeignKey
ALTER TABLE "billing_promotion_redemptions" ADD CONSTRAINT "billing_promotion_redemptions_billing_invoice_id_fkey" FOREIGN KEY ("billing_invoice_id") REFERENCES "billing_invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_subscription_terms" ADD CONSTRAINT "billing_subscription_terms_billing_customer_id_fkey" FOREIGN KEY ("billing_customer_id") REFERENCES "billing_customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_subscription_terms" ADD CONSTRAINT "billing_subscription_terms_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_subscription_terms" ADD CONSTRAINT "billing_subscription_terms_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_subscription_terms" ADD CONSTRAINT "billing_subscription_terms_source_quote_id_fkey" FOREIGN KEY ("source_quote_id") REFERENCES "billing_quotes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_checkout_orders" ADD CONSTRAINT "billing_checkout_orders_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_checkout_orders" ADD CONSTRAINT "billing_checkout_orders_billing_customer_id_fkey" FOREIGN KEY ("billing_customer_id") REFERENCES "billing_customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_checkout_orders" ADD CONSTRAINT "billing_checkout_orders_subscription_term_id_fkey" FOREIGN KEY ("subscription_term_id") REFERENCES "billing_subscription_terms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_checkout_orders" ADD CONSTRAINT "billing_checkout_orders_quote_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "billing_quotes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_invoices" ADD CONSTRAINT "billing_invoices_billing_customer_id_fkey" FOREIGN KEY ("billing_customer_id") REFERENCES "billing_customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_invoices" ADD CONSTRAINT "billing_invoices_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_invoices" ADD CONSTRAINT "billing_invoices_subscription_term_id_fkey" FOREIGN KEY ("subscription_term_id") REFERENCES "billing_subscription_terms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_invoices" ADD CONSTRAINT "billing_invoices_checkout_order_id_fkey" FOREIGN KEY ("checkout_order_id") REFERENCES "billing_checkout_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_invoice_lines" ADD CONSTRAINT "billing_invoice_lines_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "billing_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_payment_attempts" ADD CONSTRAINT "billing_payment_attempts_billing_customer_id_fkey" FOREIGN KEY ("billing_customer_id") REFERENCES "billing_customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_payment_attempts" ADD CONSTRAINT "billing_payment_attempts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_payment_attempts" ADD CONSTRAINT "billing_payment_attempts_subscription_term_id_fkey" FOREIGN KEY ("subscription_term_id") REFERENCES "billing_subscription_terms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_payment_attempts" ADD CONSTRAINT "billing_payment_attempts_checkout_order_id_fkey" FOREIGN KEY ("checkout_order_id") REFERENCES "billing_checkout_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_payment_attempts" ADD CONSTRAINT "billing_payment_attempts_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "billing_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_payments" ADD CONSTRAINT "billing_payments_payment_attempt_id_fkey" FOREIGN KEY ("payment_attempt_id") REFERENCES "billing_payment_attempts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_payments" ADD CONSTRAINT "billing_payments_billing_customer_id_fkey" FOREIGN KEY ("billing_customer_id") REFERENCES "billing_customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_payments" ADD CONSTRAINT "billing_payments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_payments" ADD CONSTRAINT "billing_payments_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "billing_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_refunds" ADD CONSTRAINT "billing_refunds_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "billing_payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_provider_event_inbox" ADD CONSTRAINT "billing_provider_event_inbox_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_provider_event_inbox" ADD CONSTRAINT "billing_provider_event_inbox_billing_customer_id_fkey" FOREIGN KEY ("billing_customer_id") REFERENCES "billing_customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_subscription_addons" ADD CONSTRAINT "billing_subscription_addons_subscription_term_id_fkey" FOREIGN KEY ("subscription_term_id") REFERENCES "billing_subscription_terms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_subscription_addons" ADD CONSTRAINT "billing_subscription_addons_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_scheduled_changes" ADD CONSTRAINT "billing_scheduled_changes_subscription_term_id_fkey" FOREIGN KEY ("subscription_term_id") REFERENCES "billing_subscription_terms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_scheduled_changes" ADD CONSTRAINT "billing_scheduled_changes_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Prevent two active billing terms for the same organization from covering the same period.
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE "billing_subscription_terms"
  ADD CONSTRAINT "billing_subscription_terms_no_overlap"
  EXCLUDE USING gist (
    "organization_id" WITH =,
    tstzrange("current_period_start", "current_period_end", '[)') WITH &&
  )
  WHERE ("status" IN ('PENDING', 'ACTIVE', 'PAST_DUE', 'SUSPENDED'));

-- Invoice line snapshots are immutable; corrections use compensating documents.
CREATE OR REPLACE FUNCTION prevent_billing_invoice_line_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'billing invoice lines are immutable; create a compensating invoice instead';
END;
$$;

CREATE TRIGGER billing_invoice_lines_immutable
BEFORE UPDATE OR DELETE ON "billing_invoice_lines"
FOR EACH ROW EXECUTE FUNCTION prevent_billing_invoice_line_mutation();

-- A payment's financial identity cannot be rewritten after verification.
CREATE OR REPLACE FUNCTION prevent_billing_payment_identity_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."payment_attempt_id" IS DISTINCT FROM OLD."payment_attempt_id"
     OR NEW."billing_customer_id" IS DISTINCT FROM OLD."billing_customer_id"
     OR NEW."organization_id" IS DISTINCT FROM OLD."organization_id"
     OR NEW."invoice_id" IS DISTINCT FROM OLD."invoice_id"
     OR NEW."provider" IS DISTINCT FROM OLD."provider"
     OR NEW."external_transaction_id" IS DISTINCT FROM OLD."external_transaction_id"
     OR NEW."amount_minor" IS DISTINCT FROM OLD."amount_minor"
     OR NEW."currency" IS DISTINCT FROM OLD."currency"
     OR NEW."received_at" IS DISTINCT FROM OLD."received_at"
  THEN
    RAISE EXCEPTION 'billing payment financial identity is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER billing_payments_identity_immutable
BEFORE UPDATE ON "billing_payments"
FOR EACH ROW EXECUTE FUNCTION prevent_billing_payment_identity_mutation();
