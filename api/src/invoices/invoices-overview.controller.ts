import { BadRequestException, Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { UserAuthGuard } from '../auth/user-auth.guard';
import { SubscriptionGuard } from '../subscription/subscription.guard';
import { assertPermission } from '../auth/permissions.util';
import { InvoicesService } from './invoices.service';

const STATUSES = ['PENDING', 'PAID', 'CANCELLED'] as const;

// Every customer's invoices in one list (the panel's "Faturas" screen).
// Tenant-wide only: a customer-scoped login keeps using its own
// /v1/customers/:id/invoices route.
@UseGuards(UserAuthGuard, SubscriptionGuard)
@Controller('v1/invoices')
export class InvoicesOverviewController {
  constructor(private readonly invoicesService: InvoicesService) {}

  @Get()
  list(@Req() req: any, @Query('status') status?: string, @Query('year') year?: string, @Query('month') month?: string) {
    assertPermission(req, 'invoices');
    if (status && !STATUSES.includes(status as (typeof STATUSES)[number])) {
      throw new BadRequestException('status must be PENDING, PAID or CANCELLED');
    }
    const y = year ? Number(year) : undefined;
    const m = month ? Number(month) : undefined;
    if ((y !== undefined && !Number.isInteger(y)) || (m !== undefined && (!Number.isInteger(m) || m < 1 || m > 12))) {
      throw new BadRequestException('invalid year/month');
    }
    return this.invoicesService.listAll(req.tenantId, {
      status: status as (typeof STATUSES)[number] | undefined,
      year: y,
      month: m,
    });
  }
}
