import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { UserAuthGuard } from '../auth/user-auth.guard';
import { assertPermission } from '../auth/permissions.util';
import { ContractsService } from './contracts.service';

// Tenant-wide portfolio view of "how much is guaranteed so far this month"
// across every customer with an active contract - the outsource owner's own
// overview, distinct from InvoicesService's usage-revenue report (which is
// built from already-generated, closed-period invoices only).
@UseGuards(UserAuthGuard)
@Controller('v1/reports/current-period')
export class CurrentPeriodReportController {
  constructor(private readonly contractsService: ContractsService) {}

  @Get()
  get(@Req() req: any) {
    assertPermission(req, 'reports');
    return this.contractsService.portfolioCurrentPeriodPreview(req.tenantId);
  }
}
