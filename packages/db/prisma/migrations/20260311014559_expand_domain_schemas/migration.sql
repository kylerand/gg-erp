-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "hr";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "identity";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "integrations";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "inventory";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "sop_ojt";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "work_orders";

-- CreateEnum
CREATE TYPE "identity"."UserStatus" AS ENUM ('INVITED', 'ACTIVE', 'SUSPENDED', 'DISABLED');

-- CreateEnum
CREATE TYPE "identity"."UserRoleAssignmentStatus" AS ENUM ('ACTIVE', 'REVOKED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "hr"."EmploymentState" AS ENUM ('ACTIVE', 'ON_LEAVE', 'TERMINATED');

-- CreateEnum
CREATE TYPE "hr"."CertificationStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'REVOKED');

-- CreateEnum
CREATE TYPE "inventory"."UomCategory" AS ENUM ('COUNT', 'LENGTH', 'WEIGHT', 'VOLUME', 'TIME', 'OTHER');

-- CreateEnum
CREATE TYPE "inventory"."PartState" AS ENUM ('ACTIVE', 'INACTIVE', 'DISCONTINUED');

-- CreateEnum
CREATE TYPE "inventory"."StockLocationType" AS ENUM ('WAREHOUSE', 'BAY', 'VAN', 'STAGING');

-- CreateEnum
CREATE TYPE "inventory"."LotState" AS ENUM ('AVAILABLE', 'QUARANTINED', 'CONSUMED', 'CLOSED');

-- CreateEnum
CREATE TYPE "inventory"."VendorState" AS ENUM ('ACTIVE', 'ON_HOLD', 'INACTIVE');

-- CreateEnum
CREATE TYPE "inventory"."PurchaseOrderState" AS ENUM ('DRAFT', 'APPROVED', 'SENT', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "work_orders"."WoStatus" AS ENUM ('DRAFT', 'READY', 'SCHEDULED', 'IN_PROGRESS', 'BLOCKED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "work_orders"."WoOperationStatus" AS ENUM ('PENDING', 'READY', 'IN_PROGRESS', 'BLOCKED', 'DONE', 'SKIPPED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "work_orders"."WoPartStatus" AS ENUM ('REQUESTED', 'RESERVED', 'PARTIALLY_CONSUMED', 'CONSUMED', 'SHORT', 'CANCELLED');

-- CreateEnum
CREATE TYPE "work_orders"."WoAssignmentStatus" AS ENUM ('ASSIGNED', 'IN_PROGRESS', 'PAUSED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "sop_ojt"."SopDocumentStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'RETIRED');

-- CreateEnum
CREATE TYPE "sop_ojt"."TrainingModuleStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'RETIRED');

-- CreateEnum
CREATE TYPE "sop_ojt"."TrainingAssignmentStatus" AS ENUM ('ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'EXEMPT', 'CANCELLED');

-- CreateEnum
CREATE TYPE "integrations"."IntegrationProvider" AS ENUM ('QUICKBOOKS', 'SHOPMONKEY', 'GENERIC');

-- CreateEnum
CREATE TYPE "integrations"."IntegrationAccountStatus" AS ENUM ('ACTIVE', 'PAUSED', 'ERROR', 'DISCONNECTED');

-- CreateEnum
CREATE TYPE "integrations"."SyncJobStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'PARTIAL', 'FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "identity"."users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "cognito_subject" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "status" "identity"."UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "last_login_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "identity"."roles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "role_code" TEXT NOT NULL,
    "role_name" TEXT NOT NULL,
    "description" TEXT,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "identity"."user_roles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "assignment_status" "identity"."UserRoleAssignmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "effective_from" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effective_to" TIMESTAMPTZ(6),
    "correlation_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr"."employees" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID,
    "employee_number" TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "employment_state" "hr"."EmploymentState" NOT NULL DEFAULT 'ACTIVE',
    "hire_date" DATE NOT NULL,
    "termination_date" DATE,
    "supervisor_employee_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "employees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr"."employee_skills" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "employee_id" UUID NOT NULL,
    "skill_code" TEXT NOT NULL,
    "proficiency_level" INTEGER NOT NULL,
    "is_certified" BOOLEAN NOT NULL DEFAULT false,
    "last_validated_at" DATE,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "employee_skills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr"."employee_certifications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "employee_id" UUID NOT NULL,
    "certification_code" TEXT NOT NULL,
    "certification_name" TEXT NOT NULL,
    "certification_status" "hr"."CertificationStatus" NOT NULL DEFAULT 'ACTIVE',
    "issued_at" DATE,
    "expires_at" DATE,
    "issuer" TEXT,
    "evidence_uri" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "employee_certifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory"."units_of_measure" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "uom_code" TEXT NOT NULL,
    "uom_name" TEXT NOT NULL,
    "uom_category" "inventory"."UomCategory" NOT NULL DEFAULT 'COUNT',
    "decimal_scale" INTEGER NOT NULL DEFAULT 3,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "units_of_measure_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory"."parts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "unit_of_measure" TEXT NOT NULL DEFAULT 'EA',
    "part_state" "inventory"."PartState" NOT NULL DEFAULT 'ACTIVE',
    "reorder_point" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "parts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory"."stock_locations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "location_code" TEXT NOT NULL,
    "location_name" TEXT NOT NULL,
    "location_type" "inventory"."StockLocationType" NOT NULL,
    "parent_location_id" UUID,
    "is_pickable" BOOLEAN NOT NULL DEFAULT true,
    "timezone_name" TEXT NOT NULL DEFAULT 'UTC',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "stock_locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory"."stock_lots" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "part_id" UUID NOT NULL,
    "stock_location_id" UUID NOT NULL,
    "lot_number" TEXT,
    "serial_number" TEXT,
    "lot_state" "inventory"."LotState" NOT NULL DEFAULT 'AVAILABLE',
    "manufactured_at" DATE,
    "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" DATE,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "stock_lots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory"."vendors" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "vendor_code" TEXT NOT NULL,
    "vendor_name" TEXT NOT NULL,
    "vendor_state" "inventory"."VendorState" NOT NULL DEFAULT 'ACTIVE',
    "email" TEXT,
    "phone" TEXT,
    "lead_time_days" INTEGER,
    "payment_terms" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "vendors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory"."purchase_orders" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "po_number" TEXT NOT NULL,
    "vendor_id" UUID NOT NULL,
    "purchase_order_state" "inventory"."PurchaseOrderState" NOT NULL DEFAULT 'DRAFT',
    "ordered_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expected_at" TIMESTAMPTZ(6),
    "sent_at" TIMESTAMPTZ(6),
    "closed_at" TIMESTAMPTZ(6),
    "notes" TEXT,
    "correlation_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory"."purchase_order_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "purchase_order_id" UUID NOT NULL,
    "line_number" INTEGER NOT NULL,
    "part_id" UUID NOT NULL,
    "ordered_quantity" DECIMAL(14,3) NOT NULL,
    "received_quantity" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "rejected_quantity" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "unit_of_measure_id" UUID NOT NULL,
    "unit_cost" DECIMAL(14,4) NOT NULL,
    "promised_at" TIMESTAMPTZ(6),
    "line_state" TEXT NOT NULL DEFAULT 'OPEN',
    "correlation_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "purchase_order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_orders"."work_orders" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "work_order_number" TEXT NOT NULL,
    "customer_reference" TEXT,
    "asset_reference" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "work_orders"."WoStatus" NOT NULL DEFAULT 'DRAFT',
    "priority" INTEGER NOT NULL DEFAULT 3,
    "stock_location_id" UUID,
    "opened_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "due_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "created_by_user_id" UUID NOT NULL,
    "updated_by_user_id" UUID,
    "correlation_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "work_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_orders"."work_order_operations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "work_order_id" UUID NOT NULL,
    "operation_code" TEXT NOT NULL,
    "sequence_no" INTEGER NOT NULL,
    "operation_name" TEXT NOT NULL,
    "required_skill_code" TEXT,
    "estimated_minutes" INTEGER NOT NULL,
    "operation_status" "work_orders"."WoOperationStatus" NOT NULL DEFAULT 'PENDING',
    "planned_start_at" TIMESTAMPTZ(6),
    "planned_end_at" TIMESTAMPTZ(6),
    "actual_start_at" TIMESTAMPTZ(6),
    "actual_end_at" TIMESTAMPTZ(6),
    "blocking_reason" TEXT,
    "correlation_id" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "work_order_operations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_orders"."work_order_parts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "work_order_id" UUID NOT NULL,
    "work_order_operation_id" UUID,
    "part_id" UUID NOT NULL,
    "requested_quantity" DECIMAL(14,3) NOT NULL,
    "reserved_quantity" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "consumed_quantity" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "part_status" "work_orders"."WoPartStatus" NOT NULL DEFAULT 'REQUESTED',
    "shortage_reason" TEXT,
    "correlation_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "work_order_parts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_orders"."work_order_assignments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "work_order_id" UUID NOT NULL,
    "work_order_operation_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "assignment_status" "work_orders"."WoAssignmentStatus" NOT NULL DEFAULT 'ASSIGNED',
    "assigned_start_at" TIMESTAMPTZ(6),
    "assigned_end_at" TIMESTAMPTZ(6),
    "actual_start_at" TIMESTAMPTZ(6),
    "actual_end_at" TIMESTAMPTZ(6),
    "notes" TEXT,
    "correlation_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "work_order_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_orders"."work_order_status_history" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "work_order_id" UUID NOT NULL,
    "from_status" TEXT,
    "to_status" TEXT NOT NULL,
    "reason_code" TEXT,
    "reason_note" TEXT,
    "actor_user_id" UUID,
    "correlation_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "work_order_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sop_ojt"."sop_documents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "document_code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "document_status" "sop_ojt"."SopDocumentStatus" NOT NULL DEFAULT 'DRAFT',
    "category" TEXT,
    "owner_employee_id" UUID,
    "current_version_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "sop_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sop_ojt"."sop_document_versions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "sop_document_id" UUID NOT NULL,
    "version_number" INTEGER NOT NULL,
    "content_markdown" TEXT NOT NULL,
    "content_hash" TEXT NOT NULL,
    "change_summary" TEXT,
    "effective_at" TIMESTAMPTZ(6),
    "correlation_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sop_document_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sop_ojt"."training_modules" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "module_code" TEXT NOT NULL,
    "sop_document_id" UUID,
    "module_name" TEXT NOT NULL,
    "description" TEXT,
    "module_status" "sop_ojt"."TrainingModuleStatus" NOT NULL DEFAULT 'ACTIVE',
    "pass_score" INTEGER,
    "validity_days" INTEGER,
    "is_required" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "training_modules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sop_ojt"."training_assignments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "module_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "assignment_status" "sop_ojt"."TrainingAssignmentStatus" NOT NULL DEFAULT 'ASSIGNED',
    "due_at" TIMESTAMPTZ(6),
    "started_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "score" DECIMAL(5,2),
    "correlation_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "training_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integrations"."integration_accounts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "provider" "integrations"."IntegrationProvider" NOT NULL,
    "account_key" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "account_status" "integrations"."IntegrationAccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "configuration" JSONB NOT NULL DEFAULT '{}',
    "last_synced_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "integration_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integrations"."sync_jobs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "integration_account_id" UUID NOT NULL,
    "job_type" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "job_status" "integrations"."SyncJobStatus" NOT NULL DEFAULT 'QUEUED',
    "started_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 5,
    "last_error_code" TEXT,
    "last_error_message" TEXT,
    "correlation_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "sync_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integrations"."sync_job_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "sync_job_id" UUID NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" UUID,
    "external_id" TEXT,
    "item_status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "error_code" TEXT,
    "error_message" TEXT,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "sync_job_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integrations"."external_id_mappings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "integration_account_id" UUID NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" UUID NOT NULL,
    "external_id" TEXT NOT NULL,
    "namespace" TEXT NOT NULL DEFAULT 'default',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "external_id_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integrations"."webhook_inbox_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "integration_account_id" UUID NOT NULL,
    "provider_event_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "processing_status" TEXT NOT NULL DEFAULT 'RECEIVED',
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ(6),
    "last_error" TEXT,
    "correlation_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "webhook_inbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_cognito_subject_key" ON "identity"."users"("cognito_subject");

-- CreateIndex
CREATE INDEX "users_status_idx" ON "identity"."users"("status");

-- CreateIndex
CREATE INDEX "user_roles_role_id_assignment_status_idx" ON "identity"."user_roles"("role_id", "assignment_status");

-- CreateIndex
CREATE UNIQUE INDEX "employees_user_id_key" ON "hr"."employees"("user_id");

-- CreateIndex
CREATE INDEX "employees_employment_state_idx" ON "hr"."employees"("employment_state");

-- CreateIndex
CREATE INDEX "parts_part_state_idx" ON "inventory"."parts"("part_state");

-- CreateIndex
CREATE INDEX "stock_lots_part_id_lot_state_idx" ON "inventory"."stock_lots"("part_id", "lot_state");

-- CreateIndex
CREATE INDEX "vendors_vendor_state_idx" ON "inventory"."vendors"("vendor_state");

-- CreateIndex
CREATE INDEX "purchase_orders_vendor_id_purchase_order_state_idx" ON "inventory"."purchase_orders"("vendor_id", "purchase_order_state");

-- CreateIndex
CREATE INDEX "purchase_order_lines_part_id_line_state_idx" ON "inventory"."purchase_order_lines"("part_id", "line_state");

-- CreateIndex
CREATE INDEX "work_orders_status_due_at_idx" ON "work_orders"."work_orders"("status", "due_at");

-- CreateIndex
CREATE UNIQUE INDEX "work_orders_work_order_number_key" ON "work_orders"."work_orders"("work_order_number");

-- CreateIndex
CREATE INDEX "work_order_operations_operation_status_idx" ON "work_orders"."work_order_operations"("operation_status");

-- CreateIndex
CREATE UNIQUE INDEX "work_order_operations_work_order_id_sequence_no_key" ON "work_orders"."work_order_operations"("work_order_id", "sequence_no");

-- CreateIndex
CREATE INDEX "work_order_parts_work_order_id_idx" ON "work_orders"."work_order_parts"("work_order_id");

-- CreateIndex
CREATE INDEX "work_order_parts_part_id_part_status_idx" ON "work_orders"."work_order_parts"("part_id", "part_status");

-- CreateIndex
CREATE INDEX "work_order_assignments_employee_id_assignment_status_idx" ON "work_orders"."work_order_assignments"("employee_id", "assignment_status");

-- CreateIndex
CREATE INDEX "work_order_assignments_work_order_operation_id_idx" ON "work_orders"."work_order_assignments"("work_order_operation_id");

-- CreateIndex
CREATE INDEX "work_order_status_history_work_order_id_created_at_idx" ON "work_orders"."work_order_status_history"("work_order_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "sop_document_versions_sop_document_id_version_number_key" ON "sop_ojt"."sop_document_versions"("sop_document_id", "version_number");

-- CreateIndex
CREATE INDEX "training_assignments_employee_id_assignment_status_idx" ON "sop_ojt"."training_assignments"("employee_id", "assignment_status");

-- CreateIndex
CREATE INDEX "sync_jobs_integration_account_id_job_status_idx" ON "integrations"."sync_jobs"("integration_account_id", "job_status");

-- CreateIndex
CREATE INDEX "sync_job_items_sync_job_id_item_status_idx" ON "integrations"."sync_job_items"("sync_job_id", "item_status");

-- CreateIndex
CREATE UNIQUE INDEX "external_id_mappings_integration_account_id_entity_type_ent_key" ON "integrations"."external_id_mappings"("integration_account_id", "entity_type", "entity_id", "namespace");

-- CreateIndex
CREATE INDEX "webhook_inbox_events_processing_status_received_at_idx" ON "integrations"."webhook_inbox_events"("processing_status", "received_at");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_inbox_events_integration_account_id_provider_event__key" ON "integrations"."webhook_inbox_events"("integration_account_id", "provider_event_id");

-- AddForeignKey
ALTER TABLE "identity"."user_roles" ADD CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "identity"."user_roles" ADD CONSTRAINT "user_roles_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "identity"."roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr"."employees" ADD CONSTRAINT "employees_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr"."employees" ADD CONSTRAINT "employees_supervisor_employee_id_fkey" FOREIGN KEY ("supervisor_employee_id") REFERENCES "hr"."employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr"."employee_skills" ADD CONSTRAINT "employee_skills_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "hr"."employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr"."employee_certifications" ADD CONSTRAINT "employee_certifications_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "hr"."employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory"."stock_locations" ADD CONSTRAINT "stock_locations_parent_location_id_fkey" FOREIGN KEY ("parent_location_id") REFERENCES "inventory"."stock_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory"."stock_lots" ADD CONSTRAINT "stock_lots_part_id_fkey" FOREIGN KEY ("part_id") REFERENCES "inventory"."parts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory"."stock_lots" ADD CONSTRAINT "stock_lots_stock_location_id_fkey" FOREIGN KEY ("stock_location_id") REFERENCES "inventory"."stock_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory"."purchase_orders" ADD CONSTRAINT "purchase_orders_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "inventory"."vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory"."purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "inventory"."purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory"."purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_part_id_fkey" FOREIGN KEY ("part_id") REFERENCES "inventory"."parts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory"."purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_unit_of_measure_id_fkey" FOREIGN KEY ("unit_of_measure_id") REFERENCES "inventory"."units_of_measure"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders"."work_orders" ADD CONSTRAINT "work_orders_stock_location_id_fkey" FOREIGN KEY ("stock_location_id") REFERENCES "inventory"."stock_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders"."work_order_operations" ADD CONSTRAINT "work_order_operations_work_order_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "work_orders"."work_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders"."work_order_parts" ADD CONSTRAINT "work_order_parts_work_order_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "work_orders"."work_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders"."work_order_parts" ADD CONSTRAINT "work_order_parts_work_order_operation_id_fkey" FOREIGN KEY ("work_order_operation_id") REFERENCES "work_orders"."work_order_operations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders"."work_order_parts" ADD CONSTRAINT "work_order_parts_part_id_fkey" FOREIGN KEY ("part_id") REFERENCES "inventory"."parts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders"."work_order_assignments" ADD CONSTRAINT "work_order_assignments_work_order_operation_id_fkey" FOREIGN KEY ("work_order_operation_id") REFERENCES "work_orders"."work_order_operations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders"."work_order_assignments" ADD CONSTRAINT "work_order_assignments_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "hr"."employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders"."work_order_status_history" ADD CONSTRAINT "work_order_status_history_work_order_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "work_orders"."work_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sop_ojt"."sop_document_versions" ADD CONSTRAINT "sop_document_versions_sop_document_id_fkey" FOREIGN KEY ("sop_document_id") REFERENCES "sop_ojt"."sop_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sop_ojt"."training_modules" ADD CONSTRAINT "training_modules_sop_document_id_fkey" FOREIGN KEY ("sop_document_id") REFERENCES "sop_ojt"."sop_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sop_ojt"."training_assignments" ADD CONSTRAINT "training_assignments_module_id_fkey" FOREIGN KEY ("module_id") REFERENCES "sop_ojt"."training_modules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sop_ojt"."training_assignments" ADD CONSTRAINT "training_assignments_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "hr"."employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integrations"."sync_jobs" ADD CONSTRAINT "sync_jobs_integration_account_id_fkey" FOREIGN KEY ("integration_account_id") REFERENCES "integrations"."integration_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integrations"."sync_job_items" ADD CONSTRAINT "sync_job_items_sync_job_id_fkey" FOREIGN KEY ("sync_job_id") REFERENCES "integrations"."sync_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integrations"."external_id_mappings" ADD CONSTRAINT "external_id_mappings_integration_account_id_fkey" FOREIGN KEY ("integration_account_id") REFERENCES "integrations"."integration_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integrations"."webhook_inbox_events" ADD CONSTRAINT "webhook_inbox_events_integration_account_id_fkey" FOREIGN KEY ("integration_account_id") REFERENCES "integrations"."integration_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
