/*
  Warnings:

  - You are about to drop the column `monthly_fee` on the `contracts` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "ContractPricingModel" AS ENUM ('FLAT_RATE', 'ALLOWANCE_PLUS_OVERAGE', 'PER_PAGE');

-- AlterTable
ALTER TABLE "contracts" DROP COLUMN "monthly_fee",
ADD COLUMN     "fixed_fee" DECIMAL(12,2),
ADD COLUMN     "minimum_pages_color" INTEGER,
ADD COLUMN     "minimum_pages_mono" INTEGER,
ADD COLUMN     "price_per_page_color" DECIMAL(12,4),
ADD COLUMN     "price_per_page_mono" DECIMAL(12,4),
ADD COLUMN     "pricing_model" "ContractPricingModel" NOT NULL DEFAULT 'ALLOWANCE_PLUS_OVERAGE',
ALTER COLUMN "included_pages_mono" DROP NOT NULL,
ALTER COLUMN "included_pages_color" DROP NOT NULL,
ALTER COLUMN "overage_price_mono" DROP NOT NULL,
ALTER COLUMN "overage_price_color" DROP NOT NULL;
