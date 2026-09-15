-- Digest-email preferences, both default to "off"/"nothing selected" -
-- see the schema comment on Tenant.notifyEmailEnabled.
ALTER TABLE "tenants" ADD COLUMN "notify_email_enabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "tenants" ADD COLUMN "notify_email_types" "NotificationType"[] NOT NULL DEFAULT ARRAY[]::"NotificationType"[];
