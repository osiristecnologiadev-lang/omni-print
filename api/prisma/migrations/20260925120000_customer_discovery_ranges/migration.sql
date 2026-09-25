-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "discovery_ranges" TEXT[] DEFAULT ARRAY[]::TEXT[];
