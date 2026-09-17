-- AlterTable
ALTER TABLE "agent_tokens" ADD COLUMN     "log_content" TEXT,
ADD COLUMN     "log_requested_at" TIMESTAMP(3),
ADD COLUMN     "log_uploaded_at" TIMESTAMP(3);
