-- CreateEnum
CREATE TYPE "planning"."CartVehicleStatus" AS ENUM ('REGISTERED', 'IN_BUILD', 'QUALITY_HOLD', 'COMPLETED', 'RETIRED');

-- CreateTable
CREATE TABLE "planning"."cart_vehicles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "vin" TEXT NOT NULL,
    "serial_number" TEXT NOT NULL,
    "model_code" TEXT NOT NULL,
    "model_year" INTEGER NOT NULL,
    "customer_id" UUID NOT NULL,
    "state" "planning"."CartVehicleStatus" NOT NULL DEFAULT 'REGISTERED',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cart_vehicles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "planning"."vin_sequences" (
    "id" SERIAL NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vin_sequences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cart_vehicles_vin_key" ON "planning"."cart_vehicles"("vin");

-- CreateIndex
CREATE UNIQUE INDEX "cart_vehicles_serial_number_key" ON "planning"."cart_vehicles"("serial_number");

-- CreateIndex
CREATE INDEX "cart_vehicles_customer_state_idx" ON "planning"."cart_vehicles"("customer_id", "state");
