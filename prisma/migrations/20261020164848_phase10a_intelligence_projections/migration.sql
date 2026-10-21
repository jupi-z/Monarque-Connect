CREATE TABLE "metric_snapshots" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "establishment_id" UUID,
  "scope_key" VARCHAR(64) NOT NULL,
  "metric_code" VARCHAR(80) NOT NULL,
  "definition_version" INTEGER NOT NULL,
  "period_start" TIMESTAMPTZ(6),
  "period_end" TIMESTAMPTZ(6),
  "as_of" TIMESTAMPTZ(6),
  "value_decimal" DECIMAL(38, 12),
  "value_json" JSONB,
  "currency" CHAR(3),
  "currency_key" VARCHAR(4) NOT NULL,
  "dimension_key" VARCHAR(512) NOT NULL,
  "calculated_at" TIMESTAMPTZ(6) NOT NULL,
  "source_as_of" TIMESTAMPTZ(6) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "metric_snapshots_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "metric_snapshots_definition_version_check" CHECK ("definition_version" > 0),
  CONSTRAINT "metric_snapshots_temporal_mode_check" CHECK (
    ("period_start" IS NOT NULL AND "period_end" IS NOT NULL AND "as_of" IS NULL AND "period_start" < "period_end")
    OR ("period_start" IS NULL AND "period_end" IS NULL AND "as_of" IS NOT NULL)
  ),
  CONSTRAINT "metric_snapshots_scope_consistency_check" CHECK (
    ("scope_key" = 'ORG' AND "establishment_id" IS NULL)
    OR ("establishment_id" IS NOT NULL AND "scope_key" = 'ESTABLISHMENT:' || "establishment_id"::TEXT)
  ),
  CONSTRAINT "metric_snapshots_currency_consistency_check" CHECK (
    ("currency_key" = 'NONE' AND "currency" IS NULL)
    OR ("currency_key" ~ '^[A-Z]{3}$' AND "currency" IS NOT NULL AND "currency" = "currency_key")
  ),
  CONSTRAINT "metric_snapshots_value_representation_check" CHECK (
    ("value_decimal" IS NOT NULL) <> ("value_json" IS NOT NULL)
  ),
  CONSTRAINT "metric_snapshots_organization_id_fkey" FOREIGN KEY ("organization_id")
    REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "metric_snapshots_establishment_id_organization_id_fkey" FOREIGN KEY ("establishment_id", "organization_id")
    REFERENCES "establishments"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "metric_snapshots_organization_id_metric_code_calculated_at_idx"
  ON "metric_snapshots"("organization_id", "metric_code", "calculated_at");
CREATE INDEX "metric_snapshots_organization_id_establishment_id_metric_code_idx"
  ON "metric_snapshots"("organization_id", "establishment_id", "metric_code");

CREATE UNIQUE INDEX "metric_snapshots_period_key"
  ON "metric_snapshots"(
    "organization_id", "scope_key", "metric_code", "definition_version", "dimension_key", "currency_key", "period_start", "period_end"
  ) WHERE "period_start" IS NOT NULL AND "period_end" IS NOT NULL;
CREATE UNIQUE INDEX "metric_snapshots_instant_key"
  ON "metric_snapshots"(
    "organization_id", "scope_key", "metric_code", "definition_version", "dimension_key", "currency_key", "as_of"
  ) WHERE "as_of" IS NOT NULL;

CREATE TABLE "insight_alerts" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "establishment_id" UUID,
  "rule_code" VARCHAR(80) NOT NULL,
  "rule_version" INTEGER NOT NULL,
  "severity" VARCHAR(16) NOT NULL,
  "status" VARCHAR(16) NOT NULL,
  "source_type" VARCHAR(32) NOT NULL,
  "source_id" UUID NOT NULL,
  "dedupe_key" VARCHAR(255) NOT NULL,
  "triggered_at" TIMESTAMPTZ(6) NOT NULL,
  "last_evaluated_at" TIMESTAMPTZ(6) NOT NULL,
  "resolved_at" TIMESTAMPTZ(6),
  "payload_json" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "insight_alerts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "insight_alerts_rule_version_check" CHECK ("rule_version" > 0),
  CONSTRAINT "insight_alerts_severity_check" CHECK ("severity" = 'WARNING'),
  CONSTRAINT "insight_alerts_status_check" CHECK ("status" IN ('OPEN', 'RESOLVED')),
  CONSTRAINT "insight_alerts_source_type_check" CHECK ("source_type" IN ('INVOICE', 'PROJECT')),
  CONSTRAINT "insight_alerts_resolution_check" CHECK (
    ("status" = 'OPEN' AND "resolved_at" IS NULL)
    OR ("status" = 'RESOLVED' AND "resolved_at" IS NOT NULL)
  ),
  CONSTRAINT "insight_alerts_organization_id_fkey" FOREIGN KEY ("organization_id")
    REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "insight_alerts_establishment_id_organization_id_fkey" FOREIGN KEY ("establishment_id", "organization_id")
    REFERENCES "establishments"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "insight_alerts_org_status_severity_eval_idx"
  ON "insight_alerts"("organization_id", "status", "severity", "last_evaluated_at");
CREATE INDEX "insight_alerts_org_estab_status_eval_idx"
  ON "insight_alerts"("organization_id", "establishment_id", "status", "last_evaluated_at");
CREATE UNIQUE INDEX "insight_alerts_open_dedupe_key"
  ON "insight_alerts"("organization_id", "dedupe_key") WHERE "status" = 'OPEN';
