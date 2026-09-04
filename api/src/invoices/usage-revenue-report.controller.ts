import { Controller, ForbiddenException, Get, Query, Req, UseGuards } from '@nestjs/common';
import { UserAuthGuard } from '../auth/user-auth.guard';
import { InvoicesService } from './invoices.service';

// Tenant-wide, portfolio-level report (unlike InvoicesController, which is
// scoped to one customer) - "how much have I billed/collected across every
// client, and how much did they actually print" over a trailing window.
@UseGuards(UserAuthGuard)
@Controller('v1/reports/usage-revenue')
export class UsageRevenueReportController {
  constructor(private readonly invoicesService: InvoicesService) {}

  @Get()
  get(@Req() req: any, @Query('months') monthsRaw?: string) {
    if (req.customerId) {
      throw new ForbiddenException('only tenant-wide users can do this');
    }
    const parsed = Number(monthsRaw);
    const months = Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, 36) : 12;
    return this.invoicesService.usageRevenueReport(req.tenantId, months);
  }
}
