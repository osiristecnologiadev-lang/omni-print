-- Per-page prices were numeric(12,4): a negotiated R$ 0,04725 was silently
-- rounded to 0,0473 on save (Amecor, 2026-11), overbilling every page.
-- Widening the scale keeps every existing value as-is.
ALTER TABLE "contracts" ALTER COLUMN "overage_price_mono" SET DATA TYPE DECIMAL(12,6);
ALTER TABLE "contracts" ALTER COLUMN "overage_price_color" SET DATA TYPE DECIMAL(12,6);
ALTER TABLE "contracts" ALTER COLUMN "price_per_page_mono" SET DATA TYPE DECIMAL(12,6);
ALTER TABLE "contracts" ALTER COLUMN "price_per_page_color" SET DATA TYPE DECIMAL(12,6);
ALTER TABLE "devices" ALTER COLUMN "color_page_price_override" SET DATA TYPE DECIMAL(12,6);
