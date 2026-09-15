import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { UserAuthGuard } from '../auth/user-auth.guard';
import { SubscriptionGuard } from '../subscription/subscription.guard';
import { assertPermission } from '../auth/permissions.util';
import { PlatformAuthGuard } from '../platform/platform-auth.guard';
import { AuditLogService } from './audit-log.service';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

function parseLimit(raw: string | undefined): number {
  const parsed = raw ? parseInt(raw, 10) : DEFAULT_LIMIT;
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_LIMIT;
  }
  return Math.min(parsed, MAX_LIMIT);
}

// `from`/`to` come from plain `<input type="date">` values (YYYY-MM-DD) -
// `to` is bumped to the end of that calendar day so the filter is inclusive
// of the whole day picked, not just its first millisecond.
function parseDateFilters(from?: string, to?: string): { from?: Date; to?: Date } {
  const fromDate = from ? new Date(from) : undefined;
  const toDate = to ? new Date(to) : undefined;
  if (toDate && !Number.isNaN(toDate.getTime())) {
    toDate.setHours(23, 59, 59, 999);
  }
  return {
    ...(fromDate && !Number.isNaN(fromDate.getTime()) ? { from: fromDate } : {}),
    ...(toDate && !Number.isNaN(toDate.getTime()) ? { to: toDate } : {}),
  };
}

@UseGuards(UserAuthGuard, SubscriptionGuard)
@Controller('v1/audit-log')
export class AuditLogController {
  constructor(private readonly auditLog: AuditLogService) {}

  // Tenant-wide only - same as every other admin-facing list in this app
  // (customers, users, contracts, ...). A customer-scoped session has no
  // business seeing tenant-wide administrative history.
  @Get()
  list(
    @Req() req: any,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
    @Query('action') action?: string,
    @Query('targetType') targetType?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    assertPermission(req, 'audit_log');
    return this.auditLog.listForTenant(req.tenantId, {
      limit: parseLimit(limit),
      cursor,
      action: action || undefined,
      targetType: targetType || undefined,
      ...parseDateFilters(from, to),
    });
  }
}

@UseGuards(PlatformAuthGuard)
@Controller('v1/platform/audit-log')
export class PlatformAuditLogController {
  constructor(private readonly auditLog: AuditLogService) {}

  @Get()
  list(
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
    @Query('action') action?: string,
    @Query('targetType') targetType?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.auditLog.listForPlatformAdmins({
      limit: parseLimit(limit),
      cursor,
      action: action || undefined,
      targetType: targetType || undefined,
      ...parseDateFilters(from, to),
    });
  }
}
