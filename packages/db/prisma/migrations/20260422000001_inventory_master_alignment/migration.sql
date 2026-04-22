-- CreateEnum
CREATE TYPE "inventory"."LifecycleLevel" AS ENUM ('RAW_MATERIAL', 'RAW_COMPONENT', 'PREPARED_COMPONENT', 'ASSEMBLED_COMPONENT');

-- CreateEnum
CREATE TYPE "inventory"."PartCategory" AS ENUM ('ELECTRONICS', 'AUDIO', 'FABRICATION', 'HARDWARE', 'SMALL_PARTS', 'DRIVE_TRAIN');

-- CreateEnum
CREATE TYPE "inventory"."InstallStage" AS ENUM ('FABRICATION', 'FRAME', 'WIRING', 'PARTS_PREP', 'FINAL_ASSEMBLY');

-- CreateEnum
CREATE TYPE "inventory"."PartColor" AS ENUM ('BLACK', 'WHITE', 'CHROME', 'RAW_STEEL', 'POWDER_COATED', 'AMBER', 'RED', 'GREY', 'BROWN', 'RAW_ALUMINUM', 'STAINLESS_STEEL');

-- CreateEnum
CREATE TYPE "inventory"."ManufacturerState" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateTable
CREATE TABLE "inventory"."manufacturers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "manufacturer_code" TEXT NOT NULL,
    "manufacturer_name" TEXT NOT NULL,
    "manufacturer_state" "inventory"."ManufacturerState" NOT NULL DEFAULT 'ACTIVE',
    "website" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "manufacturers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "manufacturers_manufacturer_code_key" ON "inventory"."manufacturers"("manufacturer_code");

-- CreateIndex
CREATE INDEX "manufacturers_manufacturer_state_idx" ON "inventory"."manufacturers"("manufacturer_state");

-- AlterTable
ALTER TABLE "inventory"."parts"
    ADD COLUMN "variant" TEXT,
    ADD COLUMN "color" "inventory"."PartColor",
    ADD COLUMN "category" "inventory"."PartCategory",
    ADD COLUMN "lifecycle_level" "inventory"."LifecycleLevel" NOT NULL DEFAULT 'RAW_COMPONENT',
    ADD COLUMN "install_stage" "inventory"."InstallStage",
    ADD COLUMN "manufacturer_id" UUID,
    ADD COLUMN "manufacturer_part_number" TEXT,
    ADD COLUMN "default_vendor_id" UUID,
    ADD COLUMN "default_location_id" UUID,
    ADD COLUMN "produced_from_part_id" UUID,
    ADD COLUMN "produced_via_stage" "inventory"."InstallStage";

-- CreateIndex
CREATE UNIQUE INDEX "parts_sku_key" ON "inventory"."parts"("sku");

-- CreateIndex
CREATE INDEX "parts_category_install_stage_idx" ON "inventory"."parts"("category", "install_stage");

-- CreateIndex
CREATE INDEX "parts_lifecycle_level_idx" ON "inventory"."parts"("lifecycle_level");

-- CreateIndex
CREATE INDEX "parts_manufacturer_id_idx" ON "inventory"."parts"("manufacturer_id");

-- CreateIndex
CREATE INDEX "parts_default_vendor_id_idx" ON "inventory"."parts"("default_vendor_id");

-- CreateIndex
CREATE INDEX "parts_produced_from_part_id_idx" ON "inventory"."parts"("produced_from_part_id");

-- AddForeignKey
ALTER TABLE "inventory"."parts"
    ADD CONSTRAINT "parts_manufacturer_id_fkey"
    FOREIGN KEY ("manufacturer_id")
    REFERENCES "inventory"."manufacturers"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory"."parts"
    ADD CONSTRAINT "parts_default_vendor_id_fkey"
    FOREIGN KEY ("default_vendor_id")
    REFERENCES "inventory"."vendors"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory"."parts"
    ADD CONSTRAINT "parts_default_location_id_fkey"
    FOREIGN KEY ("default_location_id")
    REFERENCES "inventory"."stock_locations"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory"."parts"
    ADD CONSTRAINT "parts_produced_from_part_id_fkey"
    FOREIGN KEY ("produced_from_part_id")
    REFERENCES "inventory"."parts"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
