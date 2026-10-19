-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'BILLING_CHECKOUT_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'BILLING_PAYMENT_ATTEMPT_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'BILLING_PROVIDER_EVENT_ACCEPTED';
ALTER TYPE "AuditAction" ADD VALUE 'BILLING_SUBSCRIPTION_CHANGED';

-- Platform invoice numbers are global and monotonic; SALES numbering remains tenant-scoped.
CREATE SEQUENCE billing_invoice_number_seq AS BIGINT START WITH 1 INCREMENT BY 1;
