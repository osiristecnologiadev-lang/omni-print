-- Where clicking a notification should take the viewer - see the schema
-- comment on Notification.linkHref. Nullable so pre-existing rows still
-- render (as plain, unlinked text) instead of breaking.
ALTER TABLE "notifications" ADD COLUMN "link_href" TEXT;
