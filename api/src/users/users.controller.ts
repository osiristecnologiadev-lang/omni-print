import { Body, Controller, ForbiddenException, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { UserAuthGuard } from '../auth/user-auth.guard';
import { AuditLogService } from '../audit-log/audit-log.service';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';

// Tenant-wide only, same as customer/agent-token management - a
// customer-scoped user has no business seeing or creating logins.
@UseGuards(UserAuthGuard)
@Controller('v1/users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly auditLog: AuditLogService,
  ) {}

  @Get()
  list(@Req() req: any) {
    this.assertTenantWide(req.customerId);
    return this.usersService.list(req.tenantId);
  }

  @Post()
  async create(@Req() req: any, @Body() dto: CreateUserDto) {
    this.assertTenantWide(req.customerId);
    const user = await this.usersService.create(req.tenantId, dto);
    await this.auditLog.log({
      tenantId: req.tenantId,
      actorType: 'USER',
      actorId: req.userId,
      actorLabel: req.userEmail,
      action: 'user.create',
      targetType: 'User',
      targetId: user.id,
      targetLabel: user.email,
      metadata: { customerId: user.customerId },
    });
    return user;
  }

  @Post(':id/revoke')
  async revoke(@Req() req: any, @Param('id') id: string) {
    this.assertTenantWide(req.customerId);
    const user = await this.usersService.revoke(req.tenantId, id);
    await this.auditLog.log({
      tenantId: req.tenantId,
      actorType: 'USER',
      actorId: req.userId,
      actorLabel: req.userEmail,
      action: 'user.revoke',
      targetType: 'User',
      targetId: user.id,
      targetLabel: user.email,
    });
    return user;
  }

  private assertTenantWide(customerId: string | null) {
    if (customerId) {
      throw new ForbiddenException('only tenant-wide users can do this');
    }
  }
}
