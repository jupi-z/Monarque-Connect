CREATE TABLE "foundation_probe_projections" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "value" VARCHAR(200) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "foundation_probe_projections_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "foundation_probe_projections_event_id_key" UNIQUE ("event_id")
);
