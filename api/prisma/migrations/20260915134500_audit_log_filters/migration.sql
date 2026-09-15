-- Supports the audit-log screen's new action/target-type filters (and
-- listForPlatformAdmins, which has no tenantId to filter on at all) as the
-- table grows, without falling back to a sequential scan.
CREATE INDEX "audit_log_entries_tenant_id_action_created_at_idx" ON "audit_log_entries"("tenant_id", "action", "created_at");

CREATE INDEX "audit_log_entries_tenant_id_target_type_created_at_idx" ON "audit_log_entries"("tenant_id", "target_type", "created_at");

CREATE INDEX "audit_log_entries_actor_type_created_at_idx" ON "audit_log_entries"("actor_type", "created_at");
