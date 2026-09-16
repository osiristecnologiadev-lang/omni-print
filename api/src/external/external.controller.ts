import { BadRequestException, Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { ApiKeyGuard } from '../api-keys/api-key.guard';
import { SubscriptionGuard } from '../subscription/subscription.guard';
import { DevicesService } from '../devices/devices.service';
import { CustomersService } from '../customers/customers.service';
import { InvoicesService } from '../invoices/invoices.service';

// OmniPrint's public, read-only external API - for a tenant's own outside
// tooling (a BI dashboard, a spreadsheet macro) to pull its own portfolio
// data without a user login. Authenticated by ApiKeyGuard (a static bearer
// token, not a session JWT - see that guard's own comment), always
// tenant-wide (an ApiKey has no customerId concept, unlike User), always
// read-only (every route here is a GET, deliberately - there is no
// mutating route to guard). Distinct URL prefix (v1/external/...) from
// every other v1/... route the web app itself calls, so it's immediately
// obvious from a URL alone which auth model a route expects.
@UseGuards(ApiKeyGuard, SubscriptionGuard)
@Controller('v1/external')
export class ExternalController {
  constructor(
    private readonly devicesService: DevicesService,
    private readonly customersService: CustomersService,
    private readonly invoicesService: InvoicesService,
  ) {}

  // Same underlying query as the internal /v1/devices (tenant-wide) -
  // reused rather than re-implemented, so this never drifts from what the
  // dashboard itself shows.
  @Get('devices')
  devices(@Req() req: any) {
    return this.devicesService.listWithLatestMetric(req.tenantId, null);
  }

  @Get('customers')
  customers(@Req() req: any) {
    return this.customersService.list(req.tenantId);
  }

  // customerId is required (not "list every invoice across every
  // customer") - reuses InvoicesService.list as-is rather than building a
  // new tenant-wide aggregation query for this first external-API version;
  // an integration can enumerate customerIds first via GET .../customers.
  @Get('invoices')
  invoices(@Req() req: any, @Query('customerId') customerId?: string) {
    if (!customerId) {
      throw new BadRequestException('customerId query param is required');
    }
    return this.invoicesService.list(req.tenantId, customerId);
  }

  // Same portfolio usage/revenue report the internal /v1/reports/usage-revenue
  // route serves - see that controller for the months clamp reasoning.
  @Get('reports/usage-revenue')
  usageRevenueReport(@Req() req: any, @Query('months') monthsRaw?: string) {
    const parsed = Number(monthsRaw);
    const months = Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, 36) : 12;
    return this.invoicesService.usageRevenueReport(req.tenantId, months);
  }
}
