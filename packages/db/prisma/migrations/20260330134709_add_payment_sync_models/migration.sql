-- CreateEnum
CREATE TYPE "integrations"."PaymentSyncState" AS ENUM ('PENDING', 'IN_PROGRESS', 'SYNCED', 'FAILED', 'RECONCILED', 'MISMATCH');

-- CreateEnum
CREATE TYPE "integrations"."SyncDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "integrations"."ReconciliationStatus" AS ENUM ('PENDING', 'MATCHED', 'MISMATCH', 'RESOLVED', 'SKIPPED');

-- CreateTable
CREATE TABLE "integrations"."payment_sync_records" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "invoice_sync_id" UUID,
    "work_order_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "qb_payment_id" TEXT,
    "qb_invoice_id" TEXT,
    "amount_cents" INTEGER NOT NULL,
    "payment_method" TEXT,
    "payment_date" DATE,
    "state" "integrations"."PaymentSyncState" NOT NULL DEFAULT 'PENDING',
    "direction" "integrations"."SyncDirection" NOT NULL DEFAULT 'INBOUND',
    "error_message" TEXT,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "last_attempt_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_sync_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integrations"."reconciliation_runs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(6),
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "total_records" INTEGER NOT NULL DEFAULT 0,
    "matched_count" INTEGER NOT NULL DEFAULT 0,
    "mismatch_count" INTEGER NOT NULL DEFAULT 0,
    "error_count" INTEGER NOT NULL DEFAULT 0,
    "triggered_by" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reconciliation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integrations"."reconciliation_records" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "reconciliation_type" TEXT NOT NULL,
    "erp_record_id" TEXT NOT NULL,
    "qb_record_id" TEXT,
    "status" "integrations"."ReconciliationStatus" NOT NULL DEFAULT 'PENDING',
    "erp_amount_cents" INTEGER,
    "qb_amount_cents" INTEGER,
    "discrepancy" TEXT,
    "resolved_at" TIMESTAMPTZ(6),
    "resolved_by" TEXT,
    "notes" TEXT,
    "run_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reconciliation_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payment_sync_records_work_order_id_idx" ON "integrations"."payment_sync_records"("work_order_id");

-- CreateIndex
CREATE INDEX "payment_sync_records_state_idx" ON "integrations"."payment_sync_records"("state");

-- CreateIndex
CREATE INDEX "payment_sync_records_qb_payment_id_idx" ON "integrations"."payment_sync_records"("qb_payment_id");

-- CreateIndex
CREATE INDEX "reconciliation_records_run_id_idx" ON "integrations"."reconciliation_records"("run_id");

-- CreateIndex
CREATE INDEX "reconciliation_records_status_idx" ON "integrations"."reconciliation_records"("status");

-- CreateIndex
CREATE INDEX "reconciliation_records_reconciliation_type_erp_record_id_idx" ON "integrations"."reconciliation_records"("reconciliation_type", "erp_record_id");
