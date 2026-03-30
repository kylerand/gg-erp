-- CreateEnum
CREATE TYPE "accounting"."CustomerSyncState" AS ENUM ('PENDING', 'IN_PROGRESS', 'SYNCED', 'FAILED', 'SKIPPED');

-- CreateTable
CREATE TABLE "accounting"."customer_sync_records" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "customer_id" UUID NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'QUICKBOOKS',
    "state" "accounting"."CustomerSyncState" NOT NULL DEFAULT 'PENDING',
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "last_error_code" TEXT,
    "last_error_message" TEXT,
    "external_reference" TEXT,
    "synced_at" TIMESTAMPTZ(6),
    "correlation_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "customer_sync_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "customer_sync_records_state_idx" ON "accounting"."customer_sync_records"("state");

-- CreateIndex
CREATE UNIQUE INDEX "customer_sync_records_customer_id_provider_key" ON "accounting"."customer_sync_records"("customer_id", "provider");
