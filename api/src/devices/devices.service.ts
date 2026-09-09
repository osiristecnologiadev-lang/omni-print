import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { bucketDeltas } from '../common/counter.util';
import { lowestSupplyPercent } from '../common/supplies.util';
import { forecastSupply, type SupplyReading } from '../common/supply-forecast.util';

interface DailyPoint {
  date: string;
  pages: number;
}

interface RawSupply {
  description?: string;
  class?: string;
  colorant?: string;
  level?: number;
  max_level?: number;
}

// Raw column names (snake_case) - $queryRaw bypasses Prisma's camelCase
// field mapping, so this mirrors the actual `metrics` table columns.
interface LatestMetricRow {
  id: string;
  device_id: string;
  collected_at: Date;
  online: boolean;
  printer_status: string | null;
  device_status: string | null;
  page_count: bigint | null;
  error_state: unknown;
  alerts: unknown;
  supplies: unknown;
}

@Injectable()
export class DevicesService {
  constructor(private readonly prisma: PrismaService) {}

  // customerId narrows visibility: null (tenant-wide user) sees every
  // device in the tenant; set (customer-scoped user) sees only that
  // customer's devices. See User model comment in prisma/schema.prisma.
  async listWithLatestMetric(tenantId: string, customerId: string | null) {
    const devices = await this.prisma.device.findMany({
      where: { tenantId, ...(customerId ? { customerId } : {}) },
      orderBy: { name: 'asc' },
      include: { customer: true },
    });
    if (devices.length === 0) return [];

    const deviceIds = devices.map((d) => d.id);
    // DISTINCT ON is the idiomatic Postgres way to get "latest row per
    // group" in one query - an N+1 loop would also work at this scale but
    // this stays correct as fleets grow.
    const latest = await this.prisma.$queryRaw<LatestMetricRow[]>`
      SELECT DISTINCT ON (device_id)
        id, device_id, collected_at, online, printer_status, device_status,
        page_count, error_state, alerts, supplies
      FROM metrics
      WHERE device_id = ANY(${deviceIds})
      ORDER BY device_id, collected_at DESC
    `;
    const byDevice = new Map(latest.map((m) => [m.device_id, m]));

    return devices.map((d) => ({ ...d, latestMetric: byDevice.get(d.id) ?? null }));
  }

  // Devices with no customer assigned yet - see NotificationType.UNASSIGNED_DEVICE.
  // Lightweight on purpose (no latestMetric join): this only feeds a
  // notification body, not a full device page.
  listUnassigned(tenantId: string) {
    return this.prisma.device.findMany({
      where: { tenantId, customerId: null },
      select: { id: true, name: true, printerName: true, customLabel: true, host: true, serialNumber: true },
      orderBy: { lastSeenAt: 'desc' },
    });
  }

  async listMetrics(
    tenantId: string,
    customerId: string | null,
    deviceId: string,
    opts: { limit: number; since?: Date },
  ) {
    const device = await this.prisma.device.findFirst({
      where: { id: deviceId, tenantId, ...(customerId ? { customerId } : {}) },
    });
    if (!device) {
      throw new NotFoundException('device not found');
    }

    return this.prisma.metric.findMany({
      where: {
        deviceId,
        ...(opts.since ? { collectedAt: { gte: opts.since } } : {}),
      },
      orderBy: { collectedAt: 'desc' },
      take: opts.limit,
    });
  }

  // Handles both customer reassignment and the custom label (see
  // Device.customLabel's schema comment) - both tenant-wide actions,
  // callers must check req.customerId === null before calling this. Each
  // field is only touched when actually present in the request body
  // (`!== undefined`, not just falsy) - a PATCH that only sends customLabel
  // must not accidentally unassign the device's customer, and vice versa.
  async update(
    tenantId: string,
    deviceId: string,
    dto: {
      customerId?: string | null;
      customLabel?: string | null;
      manualBaselineDate?: string | null;
      manualBaselinePageCount?: number | null;
    },
  ) {
    const device = await this.prisma.device.findFirst({ where: { id: deviceId, tenantId } });
    if (!device) {
      throw new NotFoundException('device not found');
    }

    const data: {
      customerId?: string | null;
      customLabel?: string | null;
      manualBaselineDate?: Date | null;
      manualBaselinePageCount?: bigint | null;
    } = {};

    if (dto.customerId !== undefined) {
      const customerId = dto.customerId || null;
      if (customerId) {
        const customer = await this.prisma.customer.findFirst({ where: { id: customerId, tenantId } });
        if (!customer) {
          throw new NotFoundException('customer not found');
        }
      }
      data.customerId = customerId;
    }

    if (dto.customLabel !== undefined) {
      data.customLabel = dto.customLabel?.trim() || null;
    }

    // Only meaningful as a pair - a date with no count (or vice versa) can't
    // act as a reading, so either both are present or both are cleared.
    if (dto.manualBaselineDate !== undefined || dto.manualBaselinePageCount !== undefined) {
      if (!dto.manualBaselineDate || dto.manualBaselinePageCount == null) {
        data.manualBaselineDate = null;
        data.manualBaselinePageCount = null;
      } else {
        data.manualBaselineDate = new Date(dto.manualBaselineDate);
        data.manualBaselinePageCount = BigInt(dto.manualBaselinePageCount);
      }
    }

    return this.prisma.device.update({ where: { id: deviceId }, data });
  }

  // Daily page counts for one device over the trailing `days` days - same
  // reset/glitch-safe delta logic as ContractsService.pagesInPeriod (see
  // common/counter.util.ts), just bucketed by day instead of by billing
  // period, and without a fixed calendar boundary. The last reading of each
  // day is the day's representative value; bucketDeltas turns that sequence
  // into "how many pages happened on this specific day."
  async pageTrend(tenantId: string, customerId: string | null, deviceId: string, days: number): Promise<DailyPoint[]> {
    const device = await this.prisma.device.findFirst({
      where: { id: deviceId, tenantId, ...(customerId ? { customerId } : {}) },
    });
    if (!device) {
      throw new NotFoundException('device not found');
    }
    return this.deviceDailyPageDeltas(deviceId, days);
  }

  private async deviceDailyPageDeltas(deviceId: string, days: number): Promise<DailyPoint[]> {
    const end = new Date();
    const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);

    const [baseline, inRange] = await Promise.all([
      this.prisma.metric.findFirst({
        where: { deviceId, collectedAt: { lte: start } },
        orderBy: { collectedAt: 'desc' },
        select: { collectedAt: true, pageCount: true },
      }),
      this.prisma.metric.findMany({
        where: { deviceId, collectedAt: { gt: start, lte: end } },
        orderBy: { collectedAt: 'asc' },
        select: { collectedAt: true, pageCount: true },
      }),
    ]);

    const sequence = [...(baseline ? [baseline] : []), ...inRange].filter((m) => m.pageCount != null);

    // Keep only the last reading of each day (sequence is ascending, so a
    // later Map.set for the same day key overwrites the earlier one).
    const byDay = new Map<string, number>();
    for (const m of sequence) {
      byDay.set(m.collectedAt.toISOString().slice(0, 10), Number(m.pageCount));
    }
    const daily = [...byDay.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, value]) => ({ date, value }));

    return bucketDeltas(daily).map((d) => ({ date: d.date, pages: d.delta }));
  }

  // Same shape as pageTrend but summed across every device visible to the
  // caller (respecting the same tenant/customer scoping as the device
  // list) - one line for "how much did the whole fleet print each day."
  // Missing days for a given device just don't contribute that day (no
  // fabricated zero-reading), so the total is always the real sum of
  // whatever data actually exists.
  async fleetPageTrend(tenantId: string, customerId: string | null, days: number): Promise<DailyPoint[]> {
    const devices = await this.prisma.device.findMany({
      where: { tenantId, ...(customerId ? { customerId } : {}) },
      select: { id: true },
    });

    const perDevice = await Promise.all(devices.map((d) => this.deviceDailyPageDeltas(d.id, days)));

    const totals = new Map<string, number>();
    for (const series of perDevice) {
      for (const point of series) {
        totals.set(point.date, (totals.get(point.date) ?? 0) + point.pages);
      }
    }
    return [...totals.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, pages]) => ({ date, pages }));
  }

  // Lowest supply level (%) at the last reading of each day - a declining
  // line toward 0 shows real consumption rate, not just "is it low right
  // now." No reset/delta logic needed here (unlike page counts): a supply
  // level is a direct snapshot reading, not a cumulative counter.
  async supplyTrend(tenantId: string, customerId: string | null, deviceId: string, days: number) {
    const device = await this.prisma.device.findFirst({
      where: { id: deviceId, tenantId, ...(customerId ? { customerId } : {}) },
    });
    if (!device) {
      throw new NotFoundException('device not found');
    }

    const end = new Date();
    const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
    const metrics = await this.prisma.metric.findMany({
      where: { deviceId, collectedAt: { gte: start, lte: end } },
      orderBy: { collectedAt: 'asc' },
      select: { collectedAt: true, supplies: true },
    });

    const byDay = new Map<string, number | null>();
    for (const m of metrics) {
      byDay.set(m.collectedAt.toISOString().slice(0, 10), lowestSupplyPercent(m.supplies));
    }
    return [...byDay.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, percent]) => ({ date, percent }));
  }

  // Every device visible to the caller that currently has at least one
  // active alert on its latest metric - the fleet-wide view the dashboard
  // alerts panel needs, versus today's per-device-only alert display.
  async activeAlerts(tenantId: string, customerId: string | null) {
    const devices = await this.listWithLatestMetric(tenantId, customerId);
    const rows: Array<{
      deviceId: string;
      deviceName: string;
      host: string;
      serialNumber: string | null;
      customerId: string | null;
      customerName: string | null;
      pageCount: bigint | null;
      severity: string;
      code?: number;
      description?: string;
    }> = [];
    for (const device of devices) {
      const alerts = (device.latestMetric?.alerts as Array<{ severity: string; code?: number; description?: string }> | null) ?? [];
      for (const alert of alerts) {
        rows.push({
          deviceId: device.id,
          deviceName: device.customLabel ?? device.printerName ?? device.name ?? device.host,
          host: device.host,
          serialNumber: device.serialNumber,
          customerId: device.customerId,
          customerName: device.customer?.name ?? null,
          pageCount: device.latestMetric?.page_count ?? null,
          severity: alert.severity,
          code: alert.code,
          description: alert.description,
        });
      }
    }
    // Critical first, so the most urgent items are always at the top
    // regardless of device order.
    return rows.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'critical' ? -1 : 1));
  }

  // Per-cartridge forecast for one device: current level, consumption rate,
  // estimated exhaustion date, and whether the most recent replacement (if
  // any, within the lookback window) looks premature. See
  // common/supply-forecast.util.ts for the actual math.
  async supplyForecast(tenantId: string, customerId: string | null, deviceId: string, days: number) {
    const device = await this.prisma.device.findFirst({
      where: { id: deviceId, tenantId, ...(customerId ? { customerId } : {}) },
    });
    if (!device) {
      throw new NotFoundException('device not found');
    }

    const start = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const metrics = await this.prisma.metric.findMany({
      where: { deviceId, collectedAt: { gte: start } },
      orderBy: { collectedAt: 'asc' },
      select: { collectedAt: true, supplies: true },
    });

    const now = new Date();
    return [...this.groupSupplyReadings(metrics)].map(([description, { colorant, readings }]) => ({
      description,
      colorant,
      ...forecastSupply(readings, now),
    }));
  }

  // Fleet-wide version of the above, filtered down to what's actually
  // actionable: a supply running out within `withinDays`, or one that was
  // just replaced early - not every supply on every device, which would
  // mostly be "fine, not low" noise on a dashboard panel.
  async lowSupplyForecast(tenantId: string, customerId: string | null, withinDays: number, lookbackDays: number) {
    const devices = await this.prisma.device.findMany({
      where: { tenantId, ...(customerId ? { customerId } : {}) },
      select: { id: true, name: true, printerName: true, customLabel: true, host: true, customerId: true },
    });

    const start = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);
    const now = new Date();

    // Every field forecastSupply produces, not a trimmed-down summary - the
    // outsource company acts on the concrete numbers (rate, date), not just
    // a status pill, so this list carries all of them through.
    const results: Array<{
      deviceId: string;
      deviceName: string;
      customerId: string | null;
      description: string;
      colorant: string | null;
      currentPercent: number;
      dailyConsumptionPercent: number | null;
      daysRemaining: number | null;
      estimatedEmptyDate: string | null;
      likelyEmptyAlready: boolean;
      premature: boolean;
      leftoverPercent: number | null;
      replacedAt: string | null;
    }> = [];

    for (const device of devices) {
      const metrics = await this.prisma.metric.findMany({
        where: { deviceId: device.id, collectedAt: { gte: start } },
        orderBy: { collectedAt: 'asc' },
        select: { collectedAt: true, supplies: true },
      });
      const deviceName = device.customLabel ?? device.printerName ?? device.name ?? device.host;

      for (const [description, { colorant, readings }] of this.groupSupplyReadings(metrics)) {
        const forecast = forecastSupply(readings, now);
        const dueSoon = forecast.daysRemaining != null && forecast.daysRemaining <= withinDays;
        if (dueSoon || forecast.premature) {
          results.push({
            deviceId: device.id,
            deviceName,
            customerId: device.customerId,
            description,
            colorant,
            currentPercent: forecast.currentPercent,
            dailyConsumptionPercent: forecast.dailyConsumptionPercent,
            daysRemaining: forecast.daysRemaining,
            estimatedEmptyDate: forecast.estimatedEmptyDate,
            likelyEmptyAlready: forecast.likelyEmptyAlready,
            premature: forecast.premature,
            leftoverPercent: forecast.replacement?.leftoverPercent ?? null,
            replacedAt: forecast.replacement?.at.toISOString() ?? null,
          });
        }
      }
    }

    return results.sort((a, b) => (a.daysRemaining ?? Infinity) - (b.daysRemaining ?? Infinity));
  }

  private groupSupplyReadings(
    metrics: Array<{ collectedAt: Date; supplies: unknown }>,
  ): Map<string, { colorant: string | null; readings: SupplyReading[] }> {
    const bySupply = new Map<string, { colorant: string | null; readings: SupplyReading[] }>();
    for (const m of metrics) {
      const supplies = Array.isArray(m.supplies) ? (m.supplies as RawSupply[]) : [];
      for (const s of supplies) {
        if (s.class !== 'supply' || !s.description || !s.max_level || s.max_level <= 0 || s.level == null) {
          continue;
        }
        const key = s.description;
        if (!bySupply.has(key)) {
          bySupply.set(key, { colorant: s.colorant ?? null, readings: [] });
        }
        bySupply.get(key)!.readings.push({ collectedAt: m.collectedAt, percent: (s.level / s.max_level) * 100 });
      }
    }
    return bySupply;
  }

  assertTenantWide(customerId: string | null) {
    if (customerId) {
      throw new ForbiddenException('only tenant-wide users can do this');
    }
  }
}
