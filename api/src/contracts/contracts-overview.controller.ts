import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { UserAuthGuard } from '../auth/user-auth.guard';
import { SubscriptionGuard } from '../subscription/subscription.guard';
import { assertPermission } from '../auth/permissions.util';
import { ContractsService } from './contracts.service';

// All customers' contracts side by side (the panel's "Contratos" screen).
// Tenant-wide only, same 'contracts' permission as the per-customer routes.
@UseGuards(UserAuthGuard, SubscriptionGuard)
@Controller('v1/contracts')
export class ContractsOverviewController {
  constructor(private readonly contractsService: ContractsService) {}

  @Get()
  list(@Req() req: any) {
    assertPermission(req, 'contracts');
    return this.contractsService.overview(req.tenantId);
  }
}
