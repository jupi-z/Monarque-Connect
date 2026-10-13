ALTER TABLE "purchase_orders"
  ADD COLUMN "total_net" DECIMAL(19,4) NOT NULL DEFAULT 0,
  ADD COLUMN "total_tax" DECIMAL(19,4) NOT NULL DEFAULT 0,
  ADD COLUMN "total_gross" DECIMAL(19,4) NOT NULL DEFAULT 0;

UPDATE "purchase_orders" po
SET
  "total_net" = COALESCE((SELECT SUM(pol."net_amount") FROM "purchase_order_lines" pol WHERE pol."purchase_order_id" = po."id" AND pol."organization_id" = po."organization_id"), 0),
  "total_tax" = COALESCE((SELECT SUM(pol."tax_amount") FROM "purchase_order_lines" pol WHERE pol."purchase_order_id" = po."id" AND pol."organization_id" = po."organization_id"), 0),
  "total_gross" = COALESCE((SELECT SUM(pol."gross_amount") FROM "purchase_order_lines" pol WHERE pol."purchase_order_id" = po."id" AND pol."organization_id" = po."organization_id"), 0);

ALTER TABLE "purchase_orders"
  ALTER COLUMN "total_net" DROP DEFAULT,
  ALTER COLUMN "total_tax" DROP DEFAULT,
  ALTER COLUMN "total_gross" DROP DEFAULT;
