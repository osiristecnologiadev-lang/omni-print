import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { UserAuthGuard } from '../auth/user-auth.guard';
import { SubscriptionGuard } from '../subscription/subscription.guard';
import { assertPermission } from '../auth/permissions.util';
import { InvoicesService } from './invoices.service';

// Tenant-wide, portfolio-level report (unlike InvoicesController, which is
// scoped to one customer) - "how much have I billed/collected across every
// client, and how much did they actually print" over a trailing window.
@UseGuards(UserAuthGuard, SubscriptionGuard)
@Controller('v1/reports/usage-revenue')
export class UsageRevenueReportController {
  constructor(private readonly invoicesService: InvoicesService) {}

  @Get()
  get(@Req() req: any, @Query('months') monthsRaw?: string) {
    assertPermission(req, 'reports');
    const parsed = Number(monthsRaw);
    const months = Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, 36) : 12;
    return this.invoicesService.usageRevenueReport(req.tenantId, months);
  }
}
