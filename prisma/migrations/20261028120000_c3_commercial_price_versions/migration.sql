ALTER TYPE "AuditAction" ADD VALUE 'COMMERCIAL_PRICE_VERSION_PUBLISHED';

ALTER TABLE "commercial_offers"
  ADD CONSTRAINT "commercial_offers_id_organization_product_key"
  UNIQUE ("id", "organization_id", "product_code");

CREATE TABLE "commercial_price_versions" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "product_code" VARCHAR(64) NOT NULL,
  "offer_id" UUID NOT NULL,
  "version" INTEGER NOT NULL,
  "currency_code" CHAR(3) NOT NULL,
  "amount" DECIMAL(24,8) NOT NULL,
  "price_unit_code" VARCHAR(32) NOT NULL,
  "effective_from" TIMESTAMPTZ(6) NOT NULL,
  "published_by_user_id" UUID NOT NULL,
  "command_payload_hash" VARCHAR(64) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "commercial_price_versions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "commercial_price_versions_version_check" CHECK ("version" > 0),
  CONSTRAINT "commercial_price_versions_amount_check" CHECK ("amount" > 0),
  CONSTRAINT "commercial_price_versions_payload_hash_check" CHECK ("command_payload_hash" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "commercial_price_versions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "commercial_price_versions_product_code_fkey" FOREIGN KEY ("product_code") REFERENCES "product_catalog"("code") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "commercial_price_versions_offer_org_product_fkey" FOREIGN KEY ("offer_id", "organization_id", "product_code") REFERENCES "commercial_offers"("id", "organization_id", "product_code") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "commercial_price_versions_currency_code_fkey" FOREIGN KEY ("currency_code") REFERENCES "currency_definitions"("code") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "commercial_price_versions_price_unit_code_fkey" FOREIGN KEY ("price_unit_code") REFERENCES "measure_units"("code") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "commercial_price_versions_published_by_user_id_fkey" FOREIGN KEY ("published_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "commercial_price_versions_offer_currency_version_key"
  ON "commercial_price_versions"("offer_id", "currency_code", "version");
CREATE UNIQUE INDEX "commercial_price_versions_org_offer_currency_effective_key"
  ON "commercial_price_versions"("organization_id", "offer_id", "currency_code", "effective_from");
CREATE INDEX "commercial_price_versions_price_scope_time_idx"
  ON "commercial_price_versions"("organization_id", "product_code", "offer_id", "currency_code", "effective_from" DESC);

CREATE FUNCTION "enforce_commercial_price_version_insert"() RETURNS trigger AS $$
DECLARE
  latest_version INTEGER;
  latest_effective_from TIMESTAMPTZ(6);
  offer_sell_unit VARCHAR(32);
  offer_dimension VARCHAR(32);
  offer_base_unit VARCHAR(32);
  price_dimension VARCHAR(32);
  price_base_unit VARCHAR(32);
BEGIN
  SELECT o."sell_unit_code", sell."dimension", sell."base_unit_code"
    INTO offer_sell_unit, offer_dimension, offer_base_unit
    FROM "commercial_offers" o
    JOIN "measure_units" sell ON sell."code" = o."sell_unit_code" AND sell."active" = TRUE
    WHERE o."id" = NEW."offer_id" AND o."organization_id" = NEW."organization_id"
      AND o."product_code" = NEW."product_code" AND o."status" = 'ACTIVE'
      AND EXISTS (SELECT 1 FROM "items" i WHERE i."id" = o."item_id" AND i."organization_id" = o."organization_id" AND i."active" = TRUE)
    FOR UPDATE OF o;
  IF offer_sell_unit IS NULL THEN
    RAISE EXCEPTION 'price version requires an active tenant offer and item' USING ERRCODE = '23514';
  END IF;

  SELECT "dimension", "base_unit_code" INTO price_dimension, price_base_unit
    FROM "measure_units" WHERE "code" = NEW."price_unit_code" AND "active" = TRUE;
  IF price_dimension IS NULL OR price_dimension <> offer_dimension OR price_base_unit <> offer_base_unit THEN
    RAISE EXCEPTION 'price unit is inactive or dimensionally incompatible with offer sell unit' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "currency_definitions" WHERE "code" = NEW."currency_code" AND "active" = TRUE) THEN
    RAISE EXCEPTION 'price currency is not active in the currency registry' USING ERRCODE = '23514';
  END IF;

  SELECT MAX("version"), MAX("effective_from") INTO latest_version, latest_effective_from
    FROM "commercial_price_versions"
    WHERE "offer_id" = NEW."offer_id" AND "currency_code" = NEW."currency_code";
  IF NEW."version" <> COALESCE(latest_version, 0) + 1 THEN
    RAISE EXCEPTION 'commercial price version must increase sequentially' USING ERRCODE = '23514';
  END IF;
  IF latest_effective_from IS NOT NULL AND NEW."effective_from" <= latest_effective_from THEN
    RAISE EXCEPTION 'commercial price effective times must increase strictly' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "commercial_price_versions_insert_guard"
  BEFORE INSERT ON "commercial_price_versions"
  FOR EACH ROW EXECUTE FUNCTION "enforce_commercial_price_version_insert"();

CREATE FUNCTION "reject_commercial_price_version_mutation"() RETURNS trigger AS $$
BEGIN
  -- Tenant hard deletion cascades historical rows through referential actions;
  -- direct application-level edits/deletes remain prohibited.
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'published commercial price versions are immutable' USING ERRCODE = '23514';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "commercial_price_versions_immutable"
  BEFORE UPDATE OR DELETE ON "commercial_price_versions"
  FOR EACH ROW EXECUTE FUNCTION "reject_commercial_price_version_mutation"();
