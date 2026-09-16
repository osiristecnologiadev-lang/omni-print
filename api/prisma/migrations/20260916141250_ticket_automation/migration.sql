-- DropForeignKey
ALTER TABLE "tickets" DROP CONSTRAINT "tickets_created_by_user_id_fkey";

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "auto_ticket_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "auto_ticket_types" "NotificationType"[] DEFAULT ARRAY[]::"NotificationType"[];

-- AlterTable
ALTER TABLE "tickets" ALTER COLUMN "created_by_user_id" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
