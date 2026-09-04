-- DropTable
DROP TABLE "notification_logs";

-- DropEnum
DROP TYPE "NotificationType";

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('OVERDUE_INVOICE', 'EXPIRING_CONTRACT', 'CRITICAL_DEVICE_ALERT', 'LOW_SUPPLY');

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "dedupe_key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "read_at" TIMESTAMP(3),
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "notifications_tenant_id_dedupe_key_key" ON "notifications"("tenant_id", "dedupe_key");

-- CreateIndex
CREATE INDEX "notifications_tenant_id_resolved_at_idx" ON "notifications"("tenant_id", "resolved_at");

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
