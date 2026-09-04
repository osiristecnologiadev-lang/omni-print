import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { PlatformAuthGuard } from './platform-auth.guard';
import { PlatformService } from './platform.service';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { CreateTenantUserDto } from './dto/create-tenant-user.dto';

@UseGuards(PlatformAuthGuard)
@Controller('v1/platform')
export class PlatformController {
  constructor(private readonly platformService: PlatformService) {}

  @Get('tenants')
  listTenants() {
    return this.platformService.listTenants();
  }

  @Post('tenants')
  createTenant(@Body() dto: CreateTenantDto) {
    return this.platformService.createTenant(dto.name);
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
  createTenantUser(@Param('id') id: string, @Body() dto: CreateTenantUserDto) {
    return this.platformService.createTenantUser(id, dto);
  }

  @Get('agent-fleet')
  listAgentFleet() {
    return this.platformService.listAgentFleet();
  }
}
