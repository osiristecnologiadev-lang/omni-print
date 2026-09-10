-- CreateTable
CREATE TABLE "agent_enrollment_codes" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "label" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "agent_token_id" TEXT,

    CONSTRAINT "agent_enrollment_codes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "agent_enrollment_codes_code_hash_key" ON "agent_enrollment_codes"("code_hash");

-- CreateIndex
CREATE UNIQUE INDEX "agent_enrollment_codes_agent_token_id_key" ON "agent_enrollment_codes"("agent_token_id");

-- CreateIndex
CREATE INDEX "agent_enrollment_codes_customer_id_idx" ON "agent_enrollment_codes"("customer_id");

-- AddForeignKey
ALTER TABLE "agent_enrollment_codes" ADD CONSTRAINT "agent_enrollment_codes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_enrollment_codes" ADD CONSTRAINT "agent_enrollment_codes_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_enrollment_codes" ADD CONSTRAINT "agent_enrollment_codes_agent_token_id_fkey" FOREIGN KEY ("agent_token_id") REFERENCES "agent_tokens"("id") ON DELETE SET NULL ON UPDATE CASCADE;
