-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "accounting";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "customers";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "tickets";

-- CreateEnum
CREATE TYPE "customers"."CustomerLifecycleState" AS ENUM ('LEAD', 'ACTIVE', 'INACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "tickets"."TechnicianTaskState" AS ENUM ('READY', 'IN_PROGRESS', 'BLOCKED', 'DONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "tickets"."ReworkIssueState" AS ENUM ('OPEN', 'IN_REVIEW', 'RESOLVED', 'REOPENED', 'CLOSED');

-- CreateEnum
CREATE TYPE "accounting"."InvoiceSyncState" AS ENUM ('PENDING', 'IN_PROGRESS', 'SYNCED', 'FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "customers"."customers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "state" "customers"."CustomerLifecycleState" NOT NULL DEFAULT 'LEAD',
    "external_reference" TEXT,
    "full_name" TEXT NOT NULL,
    "company_name" TEXT,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "billing_address" TEXT,
    "shipping_address" TEXT,
    "preferred_contact_method" TEXT NOT NULL DEFAULT 'EMAIL',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archived_at" TIMESTAMPTZ(6),
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tickets"."technician_tasks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "work_order_id" UUID NOT NULL,
    "routing_step_id" TEXT NOT NULL,
    "technician_id" UUID,
    "state" "tickets"."TechnicianTaskState" NOT NULL DEFAULT 'READY',
    "started_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "blocked_reason" TEXT,
    "correlation_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "technician_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tickets"."rework_issues" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "work_order_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'MEDIUM',
    "state" "tickets"."ReworkIssueState" NOT NULL DEFAULT 'OPEN',
    "reported_by" UUID NOT NULL,
    "assigned_to" UUID,
    "resolved_at" TIMESTAMPTZ(6),
    "correlation_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "rework_issues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tickets"."file_attachments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "entity_type" TEXT NOT NULL,
    "entity_id" UUID NOT NULL,
    "file_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "s3_key" TEXT NOT NULL,
    "s3_bucket" TEXT NOT NULL,
    "uploaded_by" UUID NOT NULL,
    "correlation_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "file_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting"."invoice_sync_records" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "invoice_number" TEXT NOT NULL,
    "work_order_id" UUID NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'QUICKBOOKS',
    "state" "accounting"."InvoiceSyncState" NOT NULL DEFAULT 'PENDING',
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "last_error_code" TEXT,
    "last_error_message" TEXT,
    "external_reference" TEXT,
    "synced_at" TIMESTAMPTZ(6),
    "correlation_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "invoice_sync_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "customers_state_idx" ON "customers"."customers"("state");

-- CreateIndex
CREATE INDEX "technician_tasks_work_order_id_state_idx" ON "tickets"."technician_tasks"("work_order_id", "state");

-- CreateIndex
CREATE INDEX "technician_tasks_technician_id_state_idx" ON "tickets"."technician_tasks"("technician_id", "state");

-- CreateIndex
CREATE INDEX "rework_issues_work_order_id_state_idx" ON "tickets"."rework_issues"("work_order_id", "state");

-- CreateIndex
CREATE INDEX "file_attachments_entity_type_entity_id_idx" ON "tickets"."file_attachments"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "file_attachments_uploaded_by_idx" ON "tickets"."file_attachments"("uploaded_by");

-- CreateIndex
CREATE INDEX "invoice_sync_records_work_order_id_idx" ON "accounting"."invoice_sync_records"("work_order_id");

-- CreateIndex
CREATE INDEX "invoice_sync_records_state_idx" ON "accounting"."invoice_sync_records"("state");
