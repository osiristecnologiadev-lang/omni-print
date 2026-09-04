import { Body, Controller, ForbiddenException, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { UserAuthGuard } from '../auth/user-auth.guard';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';

// Tenant-wide only, same as customer/agent-token management - a
// customer-scoped user has no business seeing or creating logins.
@UseGuards(UserAuthGuard)
@Controller('v1/users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  list(@Req() req: any) {
    this.assertTenantWide(req.customerId);
    return this.usersService.list(req.tenantId);
  }

  @Post()
  create(@Req() req: any, @Body() dto: CreateUserDto) {
    this.assertTenantWide(req.customerId);
    return this.usersService.create(req.tenantId, dto);
  }

  @Post(':id/revoke')
  revoke(@Req() req: any, @Param('id') id: string) {
    this.assertTenantWide(req.customerId);
    return this.usersService.revoke(req.tenantId, id);
  }

  private assertTenantWide(customerId: string | null) {
    if (customerId) {
      throw new ForbiddenException('only tenant-wide users can do this');
    }
  }
}
