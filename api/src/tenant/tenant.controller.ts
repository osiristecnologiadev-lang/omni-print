import { Body, Controller, ForbiddenException, Get, Patch, Req, UseGuards } from '@nestjs/common';
import { UserAuthGuard } from '../auth/user-auth.guard';
import { AuditLogService } from '../audit-log/audit-log.service';
import { TenantService } from './tenant.service';
import { UpdateTenantDto } from './dto/update-tenant.dto';

// Always operates on the caller's OWN tenant (from the JWT, via UserAuthGuard)
// - there's no tenant id in these routes, so there's nothing to check against
// another tenant's data. Tenant-wide only: a customer-scoped login has no
// business editing (or needing) its outsourcing provider's own billing
// contact info.
@UseGuards(UserAuthGuard)
@Controller('v1/tenant')
export class TenantController {
  constructor(
    private readonly tenantService: TenantService,
    private readonly auditLog: AuditLogService,
  ) {}

  @Get()
  get(@Req() req: any) {
    return this.tenantService.get(req.tenantId);
  }

  @Patch()
  async update(@Req() req: any, @Body() dto: UpdateTenantDto) {
    if (req.customerId) {
      throw new ForbiddenException('only tenant-wide users can do this');
    }
    const tenant = await this.tenantService.update(req.tenantId, dto);
    await this.auditLog.log({
      tenantId: req.tenantId,
      actorType: 'USER',
      actorId: req.userId,
      actorLabel: req.userEmail,
      action: 'tenant.update',
      targetType: 'Tenant',
      targetId: tenant.id,
      targetLabel: tenant.name,
    });
    return tenant;
  }
}
