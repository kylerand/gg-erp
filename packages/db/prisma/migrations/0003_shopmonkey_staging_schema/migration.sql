-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "migration";

-- CreateEnum
CREATE TYPE "migration"."ImportBatchStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "migration"."ImportEntityType" AS ENUM (
  'ORGANIZATION', 'EMPLOYEE', 'PART', 'INVENTORY_LOT', 'CUSTOMER',
  'ASSET', 'WORK_ORDER', 'WORK_ORDER_OPERATION', 'WORK_ORDER_PART', 'VENDOR'
);

-- CreateEnum
CREATE TYPE "migration"."ValidationStatus" AS ENUM ('VALID', 'WARN', 'INVALID');

-- CreateTable
CREATE TABLE "migration"."ImportBatch" (
  "id"          TEXT NOT NULL,
  "status"      "migration"."ImportBatchStatus" NOT NULL DEFAULT 'QUEUED',
  "wave"        TEXT NOT NULL,
  "sourceFile"  TEXT NOT NULL,
  "recordCount" INTEGER NOT NULL DEFAULT 0,
  "errorCount"  INTEGER NOT NULL DEFAULT 0,
  "startedAt"   TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "migration"."RawRecord" (
  "id"         TEXT NOT NULL,
  "batchId"    TEXT NOT NULL,
  "entityType" "migration"."ImportEntityType" NOT NULL,
  "sourceId"   TEXT NOT NULL,
  "rawJson"    JSONB NOT NULL,
  "checksum"   TEXT NOT NULL,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "RawRecord_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RawRecord_batch_source_entity_unique" UNIQUE ("batchId", "sourceId", "entityType")
);

-- CreateTable
CREATE TABLE "migration"."StageRecord" (
  "id"               TEXT NOT NULL,
  "rawRecordId"      TEXT NOT NULL,
  "entityType"       "migration"."ImportEntityType" NOT NULL,
  "stagingJson"      JSONB NOT NULL,
  "validationStatus" "migration"."ValidationStatus" NOT NULL DEFAULT 'VALID',
  "warnings"         TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL,

  CONSTRAINT "StageRecord_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "StageRecord_rawRecordId_unique" UNIQUE ("rawRecordId")
);

-- CreateTable
CREATE TABLE "migration"."DuplicateCandidate" (
  "id"           TEXT NOT NULL,
  "entityType"   "migration"."ImportEntityType" NOT NULL,
  "candidateAId" TEXT NOT NULL,
  "candidateBId" TEXT NOT NULL,
  "confidence"   DOUBLE PRECISION NOT NULL,
  "resolution"   TEXT,
  "resolvedAt"   TIMESTAMP(3),
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "DuplicateCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "migration"."ReconciliationResult" (
  "id"            TEXT NOT NULL,
  "batchId"       TEXT NOT NULL,
  "entityType"    "migration"."ImportEntityType" NOT NULL,
  "sourceCount"   INTEGER NOT NULL,
  "importedCount" INTEGER NOT NULL,
  "mismatches"    JSONB[] NOT NULL DEFAULT ARRAY[]::JSONB[],
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ReconciliationResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "migration"."MigrationError" (
  "id"           TEXT NOT NULL,
  "batchId"      TEXT NOT NULL,
  "rawRecordId"  TEXT,
  "phase"        TEXT NOT NULL,
  "errorCode"    TEXT NOT NULL,
  "errorMessage" TEXT NOT NULL,
  "retryable"    BOOLEAN NOT NULL DEFAULT false,
  "resolvedAt"   TIMESTAMP(3),
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "MigrationError_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RawRecord_batchId_idx" ON "migration"."RawRecord"("batchId");
CREATE INDEX "RawRecord_entityType_sourceId_idx" ON "migration"."RawRecord"("entityType", "sourceId");
CREATE INDEX "StageRecord_entityType_idx" ON "migration"."StageRecord"("entityType");
CREATE INDEX "StageRecord_validationStatus_idx" ON "migration"."StageRecord"("validationStatus");
CREATE INDEX "DuplicateCandidate_entityType_idx" ON "migration"."DuplicateCandidate"("entityType");
CREATE INDEX "DuplicateCandidate_resolution_idx" ON "migration"."DuplicateCandidate"("resolution");
CREATE INDEX "ReconciliationResult_batchId_idx" ON "migration"."ReconciliationResult"("batchId");
CREATE INDEX "MigrationError_batchId_idx" ON "migration"."MigrationError"("batchId");
CREATE INDEX "MigrationError_retryable_idx" ON "migration"."MigrationError"("retryable");

-- AddForeignKey
ALTER TABLE "migration"."RawRecord" ADD CONSTRAINT "RawRecord_batchId_fkey"
  FOREIGN KEY ("batchId") REFERENCES "migration"."ImportBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "migration"."StageRecord" ADD CONSTRAINT "StageRecord_rawRecordId_fkey"
  FOREIGN KEY ("rawRecordId") REFERENCES "migration"."RawRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "migration"."ReconciliationResult" ADD CONSTRAINT "ReconciliationResult_batchId_fkey"
  FOREIGN KEY ("batchId") REFERENCES "migration"."ImportBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "migration"."MigrationError" ADD CONSTRAINT "MigrationError_batchId_fkey"
  FOREIGN KEY ("batchId") REFERENCES "migration"."ImportBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "migration"."MigrationError" ADD CONSTRAINT "MigrationError_rawRecordId_fkey"
  FOREIGN KEY ("rawRecordId") REFERENCES "migration"."RawRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;
