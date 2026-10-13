CREATE TABLE "purchase_idempotency_keys" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "actor_user_id" UUID NOT NULL,
    "establishment_id" UUID NOT NULL,
    "operation" VARCHAR(80) NOT NULL,
    "key" VARCHAR(200) NOT NULL,
    "payload_hash" CHAR(64) NOT NULL,
    "resource_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "purchase_idempotency_keys_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "purchase_idempotency_keys_organization_id_actor_user_id_operation_key_key"
  ON "purchase_idempotency_keys"("organization_id", "actor_user_id", "operation", "key");
CREATE INDEX "purchase_idempotency_keys_organization_id_resource_id_idx"
  ON "purchase_idempotency_keys"("organization_id", "resource_id");

ALTER TABLE "purchase_idempotency_keys"
  ADD CONSTRAINT "purchase_idempotency_keys_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
