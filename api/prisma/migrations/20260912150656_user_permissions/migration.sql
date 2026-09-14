-- AlterTable
ALTER TABLE "users" ADD COLUMN     "permissions" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Backfill: every existing tenant-wide user (customer_id IS NULL) keeps
-- today's de facto full access - the column default alone would silently
-- lock every current staff login out of everything the moment this ships,
-- since the new permission checks read an empty array as "no access to
-- anything". Existing customer-scoped users get an explicit empty array
-- (not just relying on the column default) - preserves current behavior
-- exactly, i.e. does NOT silently grant the new invoices_view capability to
-- any existing customer login. This list is frozen as of this migration -
-- a future new permission key does not get backfilled here, only in its own
-- migration.
UPDATE "users" SET "permissions" = ARRAY[
  'contracts','invoices','customers','agent','users','devices','tickets',
  'reports','audit_log','settings','notifications'
] WHERE "customer_id" IS NULL;

UPDATE "users" SET "permissions" = ARRAY[]::TEXT[] WHERE "customer_id" IS NOT NULL;
