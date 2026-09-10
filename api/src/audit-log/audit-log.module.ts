import { Global, Module } from '@nestjs/common';
import { PlatformAuthGuard } from '../platform/platform-auth.guard';
import { AuditLogController, PlatformAuditLogController } from './audit-log.controller';
import { AuditLogService } from './audit-log.service';

// Global so any feature module's controller can inject AuditLogService
// without importing this module explicitly - same reasoning as
// PrismaModule (api/src/prisma/prisma.module.ts), since audit logging is
// called from a wide, cross-cutting set of controllers (customers, users,
// devices, contracts, invoices, tickets, notifications, tenant, platform).
@Global()
@Module({
  controllers: [AuditLogController, PlatformAuditLogController],
  // PlatformAuthGuard isn't global (see agent-releases.module.ts's own
  // comment on why) - registered here so PlatformAuditLogController can use it.
  providers: [AuditLogService, PlatformAuthGuard],
  exports: [AuditLogService],
})
export class AuditLogModule {}
