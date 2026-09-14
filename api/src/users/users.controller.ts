import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { UserAuthGuard } from '../auth/user-auth.guard';
import { assertPermission } from '../auth/permissions.util';
import { AuditLogService } from '../audit-log/audit-log.service';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserPermissionsDto } from './dto/update-user-permissions.dto';

// Tenant-wide only, same as customer/agent-token management - a
// customer-scoped user has no business seeing or creating logins. The one
// exception is 'me' below, which every session (both scopes) can call.
@UseGuards(UserAuthGuard)
@Controller('v1/users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly auditLog: AuditLogService,
  ) {}

  // No permission gate at all - this is how the frontend discovers its own
  // live customerId/permissions (can't be read off the JWT alone, since
  // permissions are deliberately not embedded there - see UserAuthGuard).
  // Returns straight off req, already populated by the guard - no service
  // call needed.
  @Get('me')
  me(@Req() req: any) {
    return { customerId: req.customerId, permissions: req.permissions };
  }

  @Get()
  list(@Req() req: any) {
    assertPermission(req, 'users');
    return this.usersService.list(req.tenantId);
  }

  @Post()
  async create(@Req() req: any, @Body() dto: CreateUserDto) {
    assertPermission(req, 'users');
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
      metadata: { customerId: user.customerId, permissions: user.permissions },
    });
    return user;
  }

  @Post(':id/revoke')
  async revoke(@Req() req: any, @Param('id') id: string) {
    assertPermission(req, 'users');
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

  @Patch(':id/permissions')
  async updatePermissions(@Req() req: any, @Param('id') id: string, @Body() dto: UpdateUserPermissionsDto) {
    assertPermission(req, 'users');
    const user = await this.usersService.updatePermissions(req.tenantId, id, dto.permissions);
    await this.auditLog.log({
      tenantId: req.tenantId,
      actorType: 'USER',
      actorId: req.userId,
      actorLabel: req.userEmail,
      action: 'user.update_permissions',
      targetType: 'User',
      targetId: user.id,
      targetLabel: user.email,
      metadata: { permissions: user.permissions },
    });
    return user;
  }
}
