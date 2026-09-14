import { Body, Controller, Get, Param, Patch, Query, Req, UseGuards } from '@nestjs/common';
import { UserAuthGuard } from '../auth/user-auth.guard';
import { SubscriptionGuard } from '../subscription/subscription.guard';
import { assertPermission } from '../auth/permissions.util';
import { AuditLogService } from '../audit-log/audit-log.service';
import { DevicesService } from './devices.service';
import { UpdateDeviceDto } from './dto/update-device.dto';

@UseGuards(UserAuthGuard, SubscriptionGuard)
@Controller('v1')
export class DevicesController {
  constructor(
    private readonly devicesService: DevicesService,
    private readonly auditLog: AuditLogService,
  ) {}

  @Get('devices')
  async list(@Req() req: any) {
    return this.devicesService.listWithLatestMetric(req.tenantId, req.customerId);
  }

  @Get('devices/trend')
  async fleetTrend(@Req() req: any, @Query('days') days?: string) {
    return this.devicesService.fleetPageTrend(req.tenantId, req.customerId, parseDays(days));
  }

  @Get('devices/current-month-pages')
  async fleetCurrentMonthPages(@Req() req: any) {
    return this.devicesService.fleetCurrentMonthPages(req.tenantId, req.customerId);
  }

  @Get('alerts')
  async activeAlerts(@Req() req: any) {
    return this.devicesService.activeAlerts(req.tenantId, req.customerId);
  }

  // "Actionable soon" list for a dashboard panel: supplies due to run out
  // within `days` (default 14), or replaced with a lot left (premature) -
  // looks back over `lookback` days (default 90, capped 180) of history to
  // find each supply's own consumption rate.
  @Get('devices/supply-forecast')
  async lowSupplyForecast(@Req() req: any, @Query('days') days?: string, @Query('lookback') lookback?: string) {
    return this.devicesService.lowSupplyForecast(
      req.tenantId,
      req.customerId,
      parseDaysWithDefault(days, 14, 90),
      parseDaysWithDefault(lookback, 90, 180),
    );
  }

  @Get('devices/:id/supply-forecast')
  async supplyForecast(@Req() req: any, @Param('id') id: string, @Query('lookback') lookback?: string) {
    return this.devicesService.supplyForecast(req.tenantId, req.customerId, id, parseDaysWithDefault(lookback, 90, 180));
  }

  @Get('devices/:id/page-trend')
  async pageTrend(@Req() req: any, @Param('id') id: string, @Query('days') days?: string) {
    return this.devicesService.pageTrend(req.tenantId, req.customerId, id, parseDays(days));
  }

  @Get('devices/:id/current-month-pages')
  async currentMonthPages(@Req() req: any, @Param('id') id: string) {
    return this.devicesService.currentMonthPages(req.tenantId, req.customerId, id);
  }

  @Get('devices/:id/supply-trend')
  async supplyTrend(@Req() req: any, @Param('id') id: string, @Query('days') days?: string) {
    return this.devicesService.supplyTrend(req.tenantId, req.customerId, id, parseDays(days));
  }

  @Get('devices/:id/metrics')
  async metrics(
    @Req() req: any,
    @Param('id') id: string,
    @Query('limit') limit?: string,
    @Query('since') since?: string,
  ) {
    const parsedLimit = limit ? Math.min(parseInt(limit, 10), 1000) : 100;
    return this.devicesService.listMetrics(req.tenantId, req.customerId, id, {
      limit: Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : 100,
      since: since ? new Date(since) : undefined,
    });
  }

  @Patch('devices/:id')
  async update(@Req() req: any, @Param('id') id: string, @Body() dto: UpdateDeviceDto) {
    assertPermission(req, 'devices');
    const device = await this.devicesService.update(req.tenantId, id, dto);
    const targetLabel = device.customLabel ?? device.printerName ?? device.name ?? device.host;

    // One PATCH here bundles up to 3 conceptually distinct admin actions
    // (see UpdateDeviceDto's own comment on why each field is independent)
    // - log one entry per field actually present, not one generic
    // "device.update", so "quem reatribuiu esse dispositivo" is a precise
    // question the log can answer directly.
    if (dto.customerId !== undefined) {
      await this.auditLog.log({
        tenantId: req.tenantId,
        actorType: 'USER',
        actorId: req.userId,
        actorLabel: req.userEmail,
        action: 'device.reassign_customer',
        targetType: 'Device',
        targetId: device.id,
        targetLabel,
        metadata: { customerId: dto.customerId },
      });
    }
    if (dto.customLabel !== undefined) {
      await this.auditLog.log({
        tenantId: req.tenantId,
        actorType: 'USER',
        actorId: req.userId,
        actorLabel: req.userEmail,
        action: 'device.set_label',
        targetType: 'Device',
        targetId: device.id,
        targetLabel,
        metadata: { customLabel: dto.customLabel },
      });
    }
    if (dto.manualBaselineDate !== undefined || dto.manualBaselinePageCount !== undefined) {
      await this.auditLog.log({
        tenantId: req.tenantId,
        actorType: 'USER',
        actorId: req.userId,
        actorLabel: req.userEmail,
        action: 'device.set_manual_baseline',
        targetType: 'Device',
        targetId: device.id,
        targetLabel,
        metadata: { manualBaselineDate: dto.manualBaselineDate, manualBaselinePageCount: dto.manualBaselinePageCount },
      });
    }

    return device;
  }
}

function parseDays(raw: string | undefined): number {
  return parseDaysWithDefault(raw, 30, 180);
}

function parseDaysWithDefault(raw: string | undefined, fallback: number, cap: number): number {
  const parsed = raw ? parseInt(raw, 10) : fallback;
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.min(parsed, cap); // cap - a chart/forecast isn't the place for someone's whole metric history
}
