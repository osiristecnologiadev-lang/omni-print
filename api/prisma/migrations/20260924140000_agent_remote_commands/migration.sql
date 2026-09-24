-- CreateEnum
CREATE TYPE "AgentCommandType" AS ENUM ('RESTART', 'UPDATE', 'DISCOVER');

-- AlterTable
ALTER TABLE "agent_tokens" ADD COLUMN     "command_acked_at" TIMESTAMP(3),
ADD COLUMN     "command_requested_at" TIMESTAMP(3),
ADD COLUMN     "command_result" TEXT,
ADD COLUMN     "command_type" "AgentCommandType";
