import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { UserAuthGuard } from '../auth/user-auth.guard';
import { assertPermission } from '../auth/permissions.util';
import { InvoicesService } from './invoices.service';

// Tenant-wide dashboard signal (unlike InvoicesController, this isn't scoped
// to one customer - it's "what across my whole portfolio needs attention").
@UseGuards(UserAuthGuard)
@Controller('v1/billing-alerts')
export class BillingAlertsController {
  constructor(private readonly invoicesService: InvoicesService) {}

  @Get()
  get(@Req() req: any) {
    assertPermission(req, 'reports');
    return this.invoicesService.alerts(req.tenantId);
  }
}
