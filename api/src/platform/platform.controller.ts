import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { PlatformAuthGuard } from './platform-auth.guard';
import { AuditLogService } from '../audit-log/audit-log.service';
import { PlatformService } from './platform.service';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { CreateTenantUserDto } from './dto/create-tenant-user.dto';

@UseGuards(PlatformAuthGuard)
@Controller('v1/platform')
export class PlatformController {
  constructor(
    private readonly platformService: PlatformService,
    private readonly auditLog: AuditLogService,
  ) {}

  @Get('tenants')
  listTenants() {
    return this.platformService.listTenants();
  }

  @Post('tenants')
  async createTenant(@Req() req: any, @Body() dto: CreateTenantDto) {
    const tenant = await this.platformService.createTenant(dto.name);
    await this.auditLog.log({
      tenantId: tenant.id,
      actorType: 'PLATFORM_ADMIN',
      actorId: req.platformAdminId,
      actorLabel: req.platformAdminEmail,
      action: 'platform.create_tenant',
      targetType: 'Tenant',
      targetId: tenant.id,
      targetLabel: tenant.name,
    });
    return tenant;
  }

  @Get('tenants/:id')
  getTenant(@Param('id') id: string) {
    return this.platformService.getTenant(id);
  }

  @Get('tenants/:id/users')
  getTenantUsers(@Param('id') id: string) {
    return this.platformService.getTenantUsers(id);
  }

  @Post('tenants/:id/users')
  async createTenantUser(@Req() req: any, @Param('id') id: string, @Body() dto: CreateTenantUserDto) {
    const user = await this.platformService.createTenantUser(id, dto);
    await this.auditLog.log({
      tenantId: id,
      actorType: 'PLATFORM_ADMIN',
      actorId: req.platformAdminId,
      actorLabel: req.platformAdminEmail,
      action: 'platform.create_tenant_user',
      targetType: 'User',
      targetId: user.id,
      targetLabel: user.email,
    });
    return user;
  }

  @Get('agent-fleet')
  listAgentFleet() {
    return this.platformService.listAgentFleet();
  }
}
