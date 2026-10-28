ALTER TYPE "AuditAction" ADD VALUE 'PRICING_FX_RATE_INGESTED';

CREATE TABLE "fx_rates" (
  "id" UUID NOT NULL,
  "base_currency_code" CHAR(3) NOT NULL,
  "quote_currency_code" CHAR(3) NOT NULL,
  "rate" DECIMAL(24,18) NOT NULL,
  "source_code" VARCHAR(64) NOT NULL,
  "source_reference" VARCHAR(256) NOT NULL,
  "observed_at" TIMESTAMPTZ(6) NOT NULL,
  "valid_from" TIMESTAMPTZ(6) NOT NULL,
  "valid_until" TIMESTAMPTZ(6) NOT NULL,
  "command_payload_hash" VARCHAR(64) NOT NULL,
  "ingested_by_user_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "fx_rates_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "fx_rates_currency_pair_check" CHECK ("base_currency_code" <> "quote_currency_code"),
  CONSTRAINT "fx_rates_rate_check" CHECK ("rate" > 0 AND "rate"::text NOT IN ('NaN', 'Infinity', '-Infinity')),
  CONSTRAINT "fx_rates_source_code_check" CHECK ("source_code" ~ '^[A-Z][A-Z0-9._-]{0,63}$'),
  CONSTRAINT "fx_rates_source_reference_check" CHECK (length(btrim("source_reference")) > 0),
  CONSTRAINT "fx_rates_validity_check" CHECK ("valid_until" > "valid_from"),
  CONSTRAINT "fx_rates_payload_hash_check" CHECK ("command_payload_hash" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "fx_rates_base_currency_code_fkey" FOREIGN KEY ("base_currency_code") REFERENCES "currency_definitions"("code") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "fx_rates_quote_currency_code_fkey" FOREIGN KEY ("quote_currency_code") REFERENCES "currency_definitions"("code") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "fx_rates_ingested_by_user_id_fkey" FOREIGN KEY ("ingested_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "fx_rate_ingestion_receipts" (
  "id" UUID NOT NULL,
  "actor_user_id" UUID NOT NULL,
  "idempotency_key" VARCHAR(200) NOT NULL,
  "payload_hash" VARCHAR(64) NOT NULL,
  "fx_rate_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "fx_rate_ingestion_receipts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "fx_rate_ingestion_receipts_key_check" CHECK (length("idempotency_key") BETWEEN 16 AND 200 AND "idempotency_key" !~ E'[\\r\\n]'),
  CONSTRAINT "fx_rate_ingestion_receipts_payload_hash_check" CHECK ("payload_hash" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "fx_rate_ingestion_receipts_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "fx_rate_ingestion_receipts_fx_rate_id_fkey" FOREIGN KEY ("fx_rate_id") REFERENCES "fx_rates"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "fx_rates_source_reference_key" ON "fx_rates"("source_code", "source_reference");
CREATE INDEX "fx_rates_pair_validity_idx" ON "fx_rates"("base_currency_code", "quote_currency_code", "valid_from", "valid_until");
CREATE INDEX "fx_rates_observed_at_idx" ON "fx_rates"("observed_at");
CREATE UNIQUE INDEX "fx_rate_ingestion_receipts_actor_key_key" ON "fx_rate_ingestion_receipts"("actor_user_id", "idempotency_key");
CREATE INDEX "fx_rate_ingestion_receipts_fx_rate_id_idx" ON "fx_rate_ingestion_receipts"("fx_rate_id");

CREATE FUNCTION "reject_fx_rate_mutation"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'accepted FX rates are immutable' USING ERRCODE = '23514';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "fx_rates_immutable"
  BEFORE UPDATE OR DELETE ON "fx_rates"
  FOR EACH ROW EXECUTE FUNCTION "reject_fx_rate_mutation"();

CREATE TRIGGER "fx_rate_ingestion_receipts_immutable"
  BEFORE UPDATE OR DELETE ON "fx_rate_ingestion_receipts"
  FOR EACH ROW EXECUTE FUNCTION "reject_fx_rate_mutation"();
