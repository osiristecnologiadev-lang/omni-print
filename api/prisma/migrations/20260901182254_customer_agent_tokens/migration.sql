-- AlterTable
ALTER TABLE "agent_tokens" ADD COLUMN     "customer_id" TEXT;

-- CreateIndex
CREATE INDEX "agent_tokens_customer_id_idx" ON "agent_tokens"("customer_id");

-- AddForeignKey
ALTER TABLE "agent_tokens" ADD CONSTRAINT "agent_tokens_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
