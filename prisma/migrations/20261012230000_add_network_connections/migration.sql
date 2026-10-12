CREATE TYPE "ConnectionRequestStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'CANCELLED');

ALTER TYPE "AuditAction" ADD VALUE 'CONNECTION_REQUEST_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'CONNECTION_REQUEST_STATUS_CHANGED';

CREATE TABLE "connection_requests" (
    "id" UUID NOT NULL,
    "source_organization_id" UUID NOT NULL,
    "target_organization_id" UUID NOT NULL,
    "status" "ConnectionRequestStatus" NOT NULL DEFAULT 'PENDING',
    "message" VARCHAR(2000),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "connection_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "connection_requests_source_organization_id_status_created_at_id_idx"
  ON "connection_requests"("source_organization_id", "status", "created_at", "id");
CREATE INDEX "connection_requests_target_organization_id_status_created_at_id_idx"
  ON "connection_requests"("target_organization_id", "status", "created_at", "id");
CREATE UNIQUE INDEX "connection_requests_pending_pair_key"
  ON "connection_requests"("source_organization_id", "target_organization_id")
  WHERE "status" = 'PENDING';

ALTER TABLE "connection_requests"
  ADD CONSTRAINT "connection_requests_source_organization_id_fkey"
  FOREIGN KEY ("source_organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "connection_requests"
  ADD CONSTRAINT "connection_requests_target_organization_id_fkey"
  FOREIGN KEY ("target_organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
