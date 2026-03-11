/*
  Warnings:

  - The `state` column on the `work_orders` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - Made the column `vehicle_id` on table `work_orders` required. This step will fail if there are existing NULL values in that column.
  - Made the column `build_configuration_id` on table `work_orders` required. This step will fail if there are existing NULL values in that column.
  - Made the column `bom_id` on table `work_orders` required. This step will fail if there are existing NULL values in that column.

*/
-- CreateEnum
CREATE TYPE "planning"."WorkOrderStatus" AS ENUM ('PLANNED', 'RELEASED', 'IN_PROGRESS', 'BLOCKED', 'COMPLETED', 'CANCELLED');

-- AlterTable
ALTER TABLE "migration"."ReconciliationResult" ALTER COLUMN "mismatches" DROP DEFAULT;

-- AlterTable
ALTER TABLE "migration"."StageRecord" ALTER COLUMN "warnings" DROP DEFAULT;

-- AlterTable
ALTER TABLE "planning"."work_orders" DROP COLUMN "state",
ADD COLUMN     "state" "planning"."WorkOrderStatus" NOT NULL DEFAULT 'PLANNED',
ALTER COLUMN "vehicle_id" SET NOT NULL,
ALTER COLUMN "build_configuration_id" SET NOT NULL,
ALTER COLUMN "bom_id" SET NOT NULL;

-- DropEnum
DROP TYPE "planning"."work_order_status";

-- CreateIndex
CREATE INDEX "work_orders_state_idx" ON "planning"."work_orders"("state");

-- RenameIndex
ALTER INDEX "migration"."RawRecord_batch_source_entity_unique" RENAME TO "RawRecord_batchId_sourceId_entityType_key";

-- RenameIndex
ALTER INDEX "migration"."StageRecord_rawRecordId_unique" RENAME TO "StageRecord_rawRecordId_key";
