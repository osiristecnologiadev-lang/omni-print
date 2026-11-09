-- Brand/model of each printer, filled by ingest (common/printer-model.util.ts).
ALTER TABLE "devices" ADD COLUMN "manufacturer" TEXT;
ALTER TABLE "devices" ADD COLUMN "model" TEXT;
