-- CreateTable
CREATE TABLE "tenants" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_tokens" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "label" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "agent_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "devices" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "serial_number" TEXT,
    "host" TEXT NOT NULL,
    "name" TEXT,
    "printer_name" TEXT,
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "metrics" (
    "id" TEXT NOT NULL,
    "device_id" TEXT NOT NULL,
    "collected_at" TIMESTAMP(3) NOT NULL,
    "online" BOOLEAN NOT NULL,
    "sys_descr" TEXT,
    "sys_name" TEXT,
    "sys_location" TEXT,
    "sys_contact" TEXT,
    "uptime_ticks" BIGINT,
    "console_display" TEXT,
    "printer_status_code" INTEGER,
    "printer_status" TEXT,
    "device_status_code" INTEGER,
    "device_status" TEXT,
    "error_state" JSONB,
    "page_count" BIGINT,
    "power_on_count" BIGINT,
    "supplies" JSONB,
    "input_trays" JSONB,
    "alerts" JSONB,
    "raw" JSONB,
    "error_message" TEXT,

    CONSTRAINT "metrics_pkey" PRIMARY KEY ("id","collected_at")
);

-- CreateIndex
CREATE UNIQUE INDEX "agent_tokens_token_hash_key" ON "agent_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "devices_tenant_id_host_idx" ON "devices"("tenant_id", "host");

-- CreateIndex
CREATE UNIQUE INDEX "devices_tenant_id_serial_number_key" ON "devices"("tenant_id", "serial_number");

-- CreateIndex
CREATE INDEX "metrics_device_id_collected_at_idx" ON "metrics"("device_id", "collected_at");

-- AddForeignKey
ALTER TABLE "agent_tokens" ADD CONSTRAINT "agent_tokens_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "metrics" ADD CONSTRAINT "metrics_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- TimescaleDB: convert metrics into a hypertable partitioned on collected_at.
-- Requires the timescale/timescaledb Docker image (see docker-compose.yml) -
-- a plain postgres image doesn't have this extension available.
CREATE EXTENSION IF NOT EXISTS timescaledb;

SELECT create_hypertable('metrics', 'collected_at');
