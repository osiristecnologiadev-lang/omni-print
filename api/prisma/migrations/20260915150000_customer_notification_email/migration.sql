-- Client contact for the device-health-only notification digest - see
-- the schema comment on Customer.notifyEmail.
ALTER TABLE "customers" ADD COLUMN "notify_email" TEXT;

-- Which customer a notification is about, when it's about one at all -
-- see the schema comment on Notification.customerId. SET NULL on delete:
-- a deleted customer just leaves the historical row unscoped, same
-- reasoning as every other optional customer_id FK in this schema
-- (e.g. devices_customer_id_fkey).
ALTER TABLE "notifications" ADD COLUMN "customer_id" TEXT;
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
