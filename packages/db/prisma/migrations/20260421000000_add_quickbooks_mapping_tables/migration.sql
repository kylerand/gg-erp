-- CreateEnum
CREATE TYPE "integrations"."DimensionMappingType" AS ENUM ('ITEM', 'INCOME_ACCOUNT', 'AR_ACCOUNT', 'PAYMENT_METHOD');

-- CreateTable
CREATE TABLE "integrations"."financial_dimension_mappings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "integration_account_id" UUID NOT NULL,
    "mapping_type" "integrations"."DimensionMappingType" NOT NULL,
    "internal_code" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "display_name" TEXT,
    "namespace" TEXT NOT NULL DEFAULT 'default',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "financial_dimension_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integrations"."tax_code_mappings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "integration_account_id" UUID NOT NULL,
    "tax_region_code" TEXT NOT NULL,
    "internal_tax_code" TEXT NOT NULL,
    "external_tax_code_id" TEXT NOT NULL,
    "external_rate_name" TEXT,
    "namespace" TEXT NOT NULL DEFAULT 'default',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "tax_code_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "financial_dimension_mappings_integration_account_id_mapping_type_internal_code_namespace_key"
    ON "integrations"."financial_dimension_mappings"("integration_account_id", "mapping_type", "internal_code", "namespace");

-- CreateIndex
CREATE UNIQUE INDEX "tax_code_mappings_integration_account_id_tax_region_code_internal_tax_code_namespace_key"
    ON "integrations"."tax_code_mappings"("integration_account_id", "tax_region_code", "internal_tax_code", "namespace");

-- CreateIndex
CREATE INDEX "tax_code_mappings_integration_account_id_is_active_idx"
    ON "integrations"."tax_code_mappings"("integration_account_id", "is_active");

-- AddForeignKey
ALTER TABLE "integrations"."financial_dimension_mappings"
    ADD CONSTRAINT "financial_dimension_mappings_integration_account_id_fkey"
    FOREIGN KEY ("integration_account_id")
    REFERENCES "integrations"."integration_accounts"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integrations"."tax_code_mappings"
    ADD CONSTRAINT "tax_code_mappings_integration_account_id_fkey"
    FOREIGN KEY ("integration_account_id")
    REFERENCES "integrations"."integration_accounts"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
