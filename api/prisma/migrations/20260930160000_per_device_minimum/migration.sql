-- AlterEnum
ALTER TYPE "ContractPricingModel" ADD VALUE 'PER_DEVICE_MINIMUM';

-- AlterTable
ALTER TABLE "contracts" ADD COLUMN     "minimum_charge_per_device" DECIMAL(12,2);

-- AlterTable
ALTER TABLE "devices" ADD COLUMN     "minimum_charge_override" DECIMAL(12,2),
ADD COLUMN     "bill_engine_counter" BOOLEAN NOT NULL DEFAULT false;
