-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'DEVICE_REVIEW';

-- AlterTable
ALTER TABLE "devices" ADD COLUMN     "review_pending" BOOLEAN NOT NULL DEFAULT false;
