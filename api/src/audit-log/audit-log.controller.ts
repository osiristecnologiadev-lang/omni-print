import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { UserAuthGuard } from '../auth/user-auth.guard';
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

@UseGuards(UserAuthGuard)
@Controller('v1/audit-log')
export class AuditLogController {
  constructor(private readonly auditLog: AuditLogService) {}

  // Tenant-wide only - same as every other admin-facing list in this app
  // (customers, users, contracts, ...). A customer-scoped session has no
  // business seeing tenant-wide administrative history.
  @Get()
  list(@Req() req: any, @Query('limit') limit?: string, @Query('cursor') cursor?: string) {
    assertPermission(req, 'audit_log');
    return this.auditLog.listForTenant(req.tenantId, { limit: parseLimit(limit), cursor });
  }
}

@UseGuards(PlatformAuthGuard)
@Controller('v1/platform/audit-log')
export class PlatformAuditLogController {
  constructor(private readonly auditLog: AuditLogService) {}

  @Get()
  list(@Query('limit') limit?: string, @Query('cursor') cursor?: string) {
    return this.auditLog.listForPlatformAdmins({ limit: parseLimit(limit), cursor });
  }
}
