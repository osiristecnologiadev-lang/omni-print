-- CreateTable
CREATE TABLE "agent_log_entries" (
    "id" TEXT NOT NULL,
    "agent_token_id" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_log_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agent_log_entries_agent_token_id_idx" ON "agent_log_entries"("agent_token_id");

-- CreateIndex
CREATE UNIQUE INDEX "agent_log_entries_agent_token_id_date_key" ON "agent_log_entries"("agent_token_id", "date");

-- AddForeignKey
ALTER TABLE "agent_log_entries" ADD CONSTRAINT "agent_log_entries_agent_token_id_fkey" FOREIGN KEY ("agent_token_id") REFERENCES "agent_tokens"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Carry forward any log already pulled under the old single-blob columns
-- (e.g. the real Amecor diagnostic pull from earlier today) before dropping
-- them, so it still shows up in the new per-day history instead of being
-- silently lost. date falls back to the upload day since the old columns
-- never recorded the agent-local day a log actually covered.
INSERT INTO "agent_log_entries" ("id", "agent_token_id", "date", "content", "uploaded_at")
SELECT gen_random_uuid(), "id", to_char("log_uploaded_at", 'YYYY-MM-DD'), "log_content", "log_uploaded_at"
FROM "agent_tokens"
WHERE "log_content" IS NOT NULL AND "log_uploaded_at" IS NOT NULL;

-- AlterTable
ALTER TABLE "agent_tokens" DROP COLUMN "log_content",
DROP COLUMN "log_uploaded_at";
