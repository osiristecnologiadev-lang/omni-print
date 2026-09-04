-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "sla_hours_high" INTEGER,
ADD COLUMN     "sla_hours_low" INTEGER,
ADD COLUMN     "sla_hours_medium" INTEGER,
ADD COLUMN     "sla_hours_urgent" INTEGER;
