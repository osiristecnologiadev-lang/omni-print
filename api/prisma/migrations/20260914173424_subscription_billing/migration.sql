-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELED');

-- AlterTable: trial_ends_at starts nullable so the backfill below can run,
-- then gets NOT NULL once every row has a value.
ALTER TABLE "tenants" ADD COLUMN     "stripe_customer_id" TEXT,
ADD COLUMN     "stripe_subscription_id" TEXT,
ADD COLUMN     "stripe_subscription_item_id" TEXT,
ADD COLUMN     "subscription_status" "SubscriptionStatus" NOT NULL DEFAULT 'TRIALING',
ADD COLUMN     "trial_ends_at" TIMESTAMP(3);

-- Backfill: every tenant that exists before this migration has been using
-- the product for free, with no trial concept at all - defaulting them to
-- TRIALING with no trial_ends_at value would either crash the NOT NULL
-- constraint below or (with a fabricated past date) instantly lock out a
-- real, already-paying-nothing production tenant the moment this ships.
-- Grandfather every existing row in as ACTIVE instead - trial_ends_at is
-- irrelevant once ACTIVE (see SubscriptionGuard's isTenantBlocked), so
-- "now" is just a harmless non-null placeholder. Only tenants created
-- AFTER this migration (via SignupService/PlatformService.createTenant)
-- get a real TRIALING status with a future trial_ends_at.
UPDATE "tenants" SET "subscription_status" = 'ACTIVE', "trial_ends_at" = CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "tenants" ALTER COLUMN "trial_ends_at" SET NOT NULL;
