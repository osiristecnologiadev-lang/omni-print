import { Body, Controller, ForbiddenException, Get, Patch, Req, UseGuards } from '@nestjs/common';
import { UserAuthGuard } from '../auth/user-auth.guard';
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
  constructor(private readonly tenantService: TenantService) {}

  @Get()
  get(@Req() req: any) {
    return this.tenantService.get(req.tenantId);
  }

  @Patch()
  update(@Req() req: any, @Body() dto: UpdateTenantDto) {
    if (req.customerId) {
      throw new ForbiddenException('only tenant-wide users can do this');
    }
    return this.tenantService.update(req.tenantId, dto);
  }
}
