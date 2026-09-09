-- AlterTable
ALTER TABLE "devices" ADD COLUMN     "manual_baseline_date" TIMESTAMP(3),
ADD COLUMN     "manual_baseline_page_count" BIGINT;
