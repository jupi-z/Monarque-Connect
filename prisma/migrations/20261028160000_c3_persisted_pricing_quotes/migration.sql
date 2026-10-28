ALTER TYPE "AuditAction" ADD VALUE 'PRICING_QUOTE_CREATED';

CREATE UNIQUE INDEX "commercial_price_versions_id_scope_offer_key"
  ON "commercial_price_versions"("id", "organization_id", "product_code", "offer_id");

CREATE UNIQUE INDEX "pricing_policy_versions_id_scope_key"
  ON "pricing_policy_versions"("id", "organization_id", "product_code");

CREATE TABLE "pricing_quotes" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "product_code" VARCHAR(64) NOT NULL,
  "establishment_id" UUID,
  "offer_id" UUID NOT NULL,
  "item_id" UUID NOT NULL,
  "variant_id" UUID,
  "price_version_id" UUID NOT NULL,
  "pricing_policy_version_id" UUID NOT NULL,
  "actor_user_id" UUID NOT NULL,
  "idempotency_key" VARCHAR(200) NOT NULL,
  "input_hash" VARCHAR(64) NOT NULL,
  "valuation_at" TIMESTAMPTZ(6) NOT NULL,
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "snapshot_version" INTEGER NOT NULL DEFAULT 1,
  "calculation_version" VARCHAR(64) NOT NULL,
  "snapshot_json" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "pricing_quotes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "pricing_quotes_idempotency_key_check" CHECK (length(btrim("idempotency_key")) BETWEEN 1 AND 200),
  CONSTRAINT "pricing_quotes_input_hash_check" CHECK ("input_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "pricing_quotes_validity_check" CHECK ("expires_at" > "valuation_at"),
  CONSTRAINT "pricing_quotes_snapshot_version_check" CHECK ("snapshot_version" > 0),
  CONSTRAINT "pricing_quotes_calculation_version_check" CHECK (length(btrim("calculation_version")) BETWEEN 1 AND 64),
  CONSTRAINT "pricing_quotes_snapshot_json_check" CHECK (jsonb_typeof("snapshot_json") = 'object'),
  CONSTRAINT "pricing_quotes_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "pricing_quotes_product_code_fkey" FOREIGN KEY ("product_code") REFERENCES "product_catalog"("code") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "pricing_quotes_establishment_org_fkey" FOREIGN KEY ("establishment_id", "organization_id") REFERENCES "establishments"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "pricing_quotes_offer_scope_fkey" FOREIGN KEY ("offer_id", "organization_id", "product_code") REFERENCES "commercial_offers"("id", "organization_id", "product_code") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "pricing_quotes_item_scope_fkey" FOREIGN KEY ("item_id", "organization_id") REFERENCES "items"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "pricing_quotes_variant_scope_fkey" FOREIGN KEY ("variant_id", "item_id", "organization_id") REFERENCES "item_variants"("id", "item_id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "pricing_quotes_price_version_scope_fkey" FOREIGN KEY ("price_version_id", "organization_id", "product_code", "offer_id") REFERENCES "commercial_price_versions"("id", "organization_id", "product_code", "offer_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "pricing_quotes_policy_version_scope_fkey" FOREIGN KEY ("pricing_policy_version_id", "organization_id", "product_code") REFERENCES "pricing_policy_versions"("id", "organization_id", "product_code") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "pricing_quotes_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "pricing_quotes_org_idempotency_key" ON "pricing_quotes"("organization_id", "idempotency_key");
CREATE UNIQUE INDEX "pricing_quotes_id_organization_id_key" ON "pricing_quotes"("id", "organization_id");
CREATE INDEX "pricing_quotes_org_product_establishment_created_idx" ON "pricing_quotes"("organization_id", "product_code", "establishment_id", "created_at" DESC, "id");
CREATE INDEX "pricing_quotes_offer_valuation_idx" ON "pricing_quotes"("offer_id", "valuation_at");

CREATE TABLE "pricing_quote_lines" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "quote_id" UUID NOT NULL,
  "line_index" INTEGER NOT NULL,
  "snapshot_json" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "pricing_quote_lines_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "pricing_quote_lines_index_check" CHECK ("line_index" >= 0),
  CONSTRAINT "pricing_quote_lines_snapshot_json_check" CHECK (jsonb_typeof("snapshot_json") = 'object'),
  CONSTRAINT "pricing_quote_lines_quote_scope_fkey" FOREIGN KEY ("quote_id", "organization_id") REFERENCES "pricing_quotes"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "pricing_quote_lines_quote_id_line_index_key" ON "pricing_quote_lines"("quote_id", "line_index");
CREATE INDEX "pricing_quote_lines_organization_id_quote_id_idx" ON "pricing_quote_lines"("organization_id", "quote_id");

CREATE FUNCTION "reject_pricing_quote_snapshot_mutation"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'pricing quote snapshots are immutable' USING ERRCODE = '23514';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "pricing_quotes_immutable"
  BEFORE UPDATE OR DELETE ON "pricing_quotes"
  FOR EACH ROW EXECUTE FUNCTION "reject_pricing_quote_snapshot_mutation"();

CREATE TRIGGER "pricing_quote_lines_immutable"
  BEFORE UPDATE OR DELETE ON "pricing_quote_lines"
  FOR EACH ROW EXECUTE FUNCTION "reject_pricing_quote_snapshot_mutation"();
