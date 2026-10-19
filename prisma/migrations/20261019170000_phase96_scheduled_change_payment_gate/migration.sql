ALTER TABLE "billing_scheduled_changes" ADD COLUMN "billing_invoice_id" UUID;

ALTER TABLE "billing_scheduled_changes"
ADD CONSTRAINT "billing_scheduled_changes_billing_invoice_id_fkey"
FOREIGN KEY ("billing_invoice_id") REFERENCES "billing_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "billing_scheduled_changes_billing_invoice_id_key"
ON "billing_scheduled_changes"("billing_invoice_id");
