CREATE TABLE "foundation_probes" (
    "id" UUID NOT NULL,
    "value" VARCHAR(200) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "foundation_probes_pkey" PRIMARY KEY ("id")
);
