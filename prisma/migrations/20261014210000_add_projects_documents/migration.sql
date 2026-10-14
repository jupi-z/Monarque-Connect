-- Phase 8: Projects, Tasks, Documents and tenant-scoped document links.
ALTER TYPE "AuditAction" ADD VALUE 'PROJECT_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'PROJECT_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE 'PROJECT_STATUS_CHANGED';
ALTER TYPE "AuditAction" ADD VALUE 'TASK_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'TASK_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE 'TASK_STATUS_CHANGED';
ALTER TYPE "AuditAction" ADD VALUE 'DOCUMENT_UPLOAD_STARTED';
ALTER TYPE "AuditAction" ADD VALUE 'DOCUMENT_AVAILABLE';
ALTER TYPE "AuditAction" ADD VALUE 'DOCUMENT_LINKED';
ALTER TYPE "AuditAction" ADD VALUE 'DOCUMENT_UNLINKED';
ALTER TYPE "AuditAction" ADD VALUE 'DOCUMENT_REVOKED';

CREATE TYPE "ProjectStatus" AS ENUM ('PLANNED', 'ACTIVE', 'COMPLETED', 'CANCELLED');
CREATE TYPE "TaskStatus" AS ENUM ('TODO', 'IN_PROGRESS', 'DONE', 'CANCELLED');
CREATE TYPE "DocumentStatus" AS ENUM ('PENDING_UPLOAD', 'AVAILABLE', 'QUARANTINED', 'REVOKED');
CREATE TYPE "DocumentClassification" AS ENUM ('INTERNAL', 'CONFIDENTIAL', 'RESTRICTED');
CREATE TYPE "DocumentLinkTargetType" AS ENUM ('PROJECT', 'TASK', 'OPPORTUNITY', 'PARTY', 'QUOTE', 'SALES_ORDER', 'INVOICE', 'PAYMENT_RECORD', 'SUPPLIER_RFQ', 'PURCHASE_ORDER', 'GOODS_RECEIPT', 'EXPENSE');

CREATE UNIQUE INDEX "opportunities_id_organization_id_key"
ON "opportunities"("id", "organization_id");

CREATE TABLE "projects" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "establishment_id" UUID NOT NULL,
    "party_id" UUID,
    "opportunity_id" UUID,
    "name" VARCHAR(160) NOT NULL,
    "description" VARCHAR(5000),
    "starts_on" DATE,
    "due_on" DATE,
    "status" "ProjectStatus" NOT NULL DEFAULT 'PLANNED',
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "completed_at" TIMESTAMPTZ(6),
    "cancelled_at" TIMESTAMPTZ(6),
    CONSTRAINT "projects_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "projects_dates_check" CHECK ("starts_on" IS NULL OR "due_on" IS NULL OR "due_on" >= "starts_on")
);
CREATE UNIQUE INDEX "projects_id_organization_id_key" ON "projects"("id", "organization_id");
CREATE INDEX "projects_organization_id_establishment_id_status_created_at_id_idx" ON "projects"("organization_id", "establishment_id", "status", "created_at", "id");
CREATE INDEX "projects_organization_id_party_id_created_at_idx" ON "projects"("organization_id", "party_id", "created_at");
CREATE INDEX "projects_organization_id_opportunity_id_idx" ON "projects"("organization_id", "opportunity_id");

CREATE TABLE "tasks" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "description" VARCHAR(5000),
    "assignee_user_id" UUID,
    "due_on" DATE,
    "status" "TaskStatus" NOT NULL DEFAULT 'TODO',
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "completed_at" TIMESTAMPTZ(6),
    "cancelled_at" TIMESTAMPTZ(6),
    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "tasks_position_check" CHECK ("position" >= 0)
);
CREATE UNIQUE INDEX "tasks_id_organization_id_key" ON "tasks"("id", "organization_id");
CREATE INDEX "tasks_organization_id_project_id_status_position_created_at_id_idx" ON "tasks"("organization_id", "project_id", "status", "position", "created_at", "id");
CREATE INDEX "tasks_organization_id_assignee_user_id_status_idx" ON "tasks"("organization_id", "assignee_user_id", "status");

CREATE TABLE "documents" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "establishment_id" UUID,
    "original_filename" VARCHAR(255) NOT NULL,
    "media_type" VARCHAR(160) NOT NULL,
    "byte_size" BIGINT NOT NULL,
    "checksum_sha256" CHAR(64),
    "storage_key" VARCHAR(512),
    "status" "DocumentStatus" NOT NULL DEFAULT 'PENDING_UPLOAD',
    "classification" "DocumentClassification" NOT NULL DEFAULT 'INTERNAL',
    "uploaded_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "revocation_reason" VARCHAR(2000),
    CONSTRAINT "documents_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "documents_byte_size_check" CHECK ("byte_size" >= 0),
    CONSTRAINT "documents_checksum_sha256_check" CHECK ("checksum_sha256" IS NULL OR "checksum_sha256" ~ '^[0-9a-fA-F]{64}$')
);
CREATE UNIQUE INDEX "documents_storage_key_key" ON "documents"("storage_key");
CREATE UNIQUE INDEX "documents_id_organization_id_key" ON "documents"("id", "organization_id");
CREATE INDEX "documents_organization_id_establishment_id_status_created_at_id_idx" ON "documents"("organization_id", "establishment_id", "status", "created_at", "id");
CREATE INDEX "documents_organization_id_classification_created_at_id_idx" ON "documents"("organization_id", "classification", "created_at", "id");

CREATE TABLE "document_links" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "establishment_id" UUID,
    "target_type" "DocumentLinkTargetType" NOT NULL,
    "target_id" UUID NOT NULL,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "document_links_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "document_links_id_organization_id_key" ON "document_links"("id", "organization_id");
CREATE UNIQUE INDEX "document_links_organization_id_document_id_target_type_target_id_key" ON "document_links"("organization_id", "document_id", "target_type", "target_id");
CREATE INDEX "document_links_organization_id_target_type_target_id_created_at_id_idx" ON "document_links"("organization_id", "target_type", "target_id", "created_at", "id");

CREATE TABLE "phase8_idempotency_keys" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "actor_user_id" UUID NOT NULL,
    "operation" VARCHAR(80) NOT NULL,
    "key" VARCHAR(200) NOT NULL,
    "payload_hash" VARCHAR(128) NOT NULL,
    "resource_type" VARCHAR(80) NOT NULL,
    "resource_id" UUID NOT NULL,
    "establishment_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "phase8_idempotency_keys_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "phase8_idempotency_keys_organization_id_actor_user_id_operation_key_key" ON "phase8_idempotency_keys"("organization_id", "actor_user_id", "operation", "key");
CREATE INDEX "phase8_idempotency_keys_organization_id_resource_type_resource_id_created_at_idx" ON "phase8_idempotency_keys"("organization_id", "resource_type", "resource_id", "created_at");

ALTER TABLE "projects" ADD CONSTRAINT "projects_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "projects" ADD CONSTRAINT "projects_establishment_id_organization_id_fkey" FOREIGN KEY ("establishment_id", "organization_id") REFERENCES "establishments"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "projects" ADD CONSTRAINT "projects_party_id_organization_id_fkey" FOREIGN KEY ("party_id", "organization_id") REFERENCES "business_parties"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "projects" ADD CONSTRAINT "projects_opportunity_id_organization_id_fkey" FOREIGN KEY ("opportunity_id", "organization_id") REFERENCES "opportunities"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "projects" ADD CONSTRAINT "projects_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "tasks" ADD CONSTRAINT "tasks_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_project_id_organization_id_fkey" FOREIGN KEY ("project_id", "organization_id") REFERENCES "projects"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "documents" ADD CONSTRAINT "documents_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "documents" ADD CONSTRAINT "documents_establishment_id_organization_id_fkey" FOREIGN KEY ("establishment_id", "organization_id") REFERENCES "establishments"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "documents" ADD CONSTRAINT "documents_uploaded_by_user_id_fkey" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "document_links" ADD CONSTRAINT "document_links_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "document_links" ADD CONSTRAINT "document_links_document_id_organization_id_fkey" FOREIGN KEY ("document_id", "organization_id") REFERENCES "documents"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "document_links" ADD CONSTRAINT "document_links_establishment_id_organization_id_fkey" FOREIGN KEY ("establishment_id", "organization_id") REFERENCES "establishments"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "document_links" ADD CONSTRAINT "document_links_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "phase8_idempotency_keys" ADD CONSTRAINT "phase8_idempotency_keys_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "phase8_idempotency_keys" ADD CONSTRAINT "phase8_idempotency_keys_establishment_id_organization_id_fkey" FOREIGN KEY ("establishment_id", "organization_id") REFERENCES "establishments"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
