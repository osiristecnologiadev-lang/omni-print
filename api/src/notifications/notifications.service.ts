import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Notification, NotificationType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { InvoicesService } from '../invoices/invoices.service';
import { DevicesService } from '../devices/devices.service';

function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return '';
  return new Date(d).toLocaleDateString('pt-BR', { timeZone: 'UTC' });
}

interface CurrentAlert {
  type: NotificationType;
  dedupeKey: string;
  title: string;
  body: string;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly invoicesService: InvoicesService,
    private readonly devicesService: DevicesService,
  ) {}

  // Runs nightly, after invoice generation (2am) so an invoice that just
  // became overdue is already reflected - see InvoicesService.generateDueInvoices.
  // Also callable on demand (POST /v1/notifications/sync) so a tenant admin
  // can refresh without waiting for the cron.
  @Cron(CronExpression.EVERY_DAY_AT_7AM)
  async syncAllTenants(): Promise<void> {
    const tenants = await this.prisma.tenant.findMany({ select: { id: true } });
    for (const tenant of tenants) {
      try {
        await this.syncNotifications(tenant.id);
      } catch (err) {
        this.logger.error(`notification sync failed for tenant ${tenant.id}`, err as Error);
      }
    }
  }

  // Builds the current, structured list of everything wrong for a tenant
  // right now, straight from the same three sources the old email digest
  // used (InvoicesService.alerts, DevicesService.activeAlerts filtered to
  // critical, DevicesService.lowSupplyForecast) - just shaped as individual
  // dedupeKey'd items instead of one bundled text blob.
  private async collectCurrentAlerts(tenantId: string): Promise<CurrentAlert[]> {
    const [billingAlerts, activeAlerts, lowSupplies, unassignedDevices] = await Promise.all([
      this.invoicesService.alerts(tenantId),
      this.devicesService.activeAlerts(tenantId, null),
      this.devicesService.lowSupplyForecast(tenantId, null, 14, 90),
      this.devicesService.listUnassigned(tenantId),
    ]);
    const criticalDeviceAlerts = activeAlerts.filter((a) => a.severity === 'critical');

    const items: CurrentAlert[] = [];

    for (const inv of billingAlerts.overdueInvoices) {
      items.push({
        type: 'OVERDUE_INVOICE',
        dedupeKey: `invoice:${inv.id}`,
        title: `Fatura vencida: ${inv.customer.name}`,
        body: `Vencida em ${fmtDate(inv.dueDate)}, R$ ${Number(inv.totalDue).toFixed(2)}.`,
      });
    }

    for (const c of billingAlerts.expiringContracts) {
      items.push({
        type: 'EXPIRING_CONTRACT',
        dedupeKey: `contract:${c.id}`,
        title: `Contrato próximo do fim: ${c.customer.name}`,
        body: `Vence em ${fmtDate(c.endDate)}.`,
      });
    }

    for (const a of criticalDeviceAlerts) {
      items.push({
        type: 'CRITICAL_DEVICE_ALERT',
        dedupeKey: `device-alert:${a.deviceId}:${a.code ?? a.description ?? 'critical'}`,
        title: `Alerta crítico: ${a.deviceName}`,
        body: a.description ?? 'Alerta crítico reportado pelo dispositivo.',
      });
    }

    for (const s of lowSupplies) {
      const detail = s.premature
        ? `troca antecipada, ${s.leftoverPercent}% restante`
        : s.likelyEmptyAlready
          ? 'provavelmente já esgotado'
          : `~${s.daysRemaining} dia(s) restantes (esgota em ${fmtDate(s.estimatedEmptyDate)})`;
      items.push({
        type: 'LOW_SUPPLY',
        dedupeKey: `supply:${s.deviceId}:${s.description}`,
        title: `Suprimento baixo: ${s.deviceName} · ${s.description}`,
        body: detail,
      });
    }

    // Most tenants only ever see this transiently (a device sits
    // unassigned for the few minutes between discovery and routine
    // sorting), but it's real and ongoing when one physical network is
    // shared by more than one of the tenant's own customers - see
    // IngestService.upsertDevice's comment on why customerId is never
    // auto-corrected once set, and DevicesController's customer-picker for
    // where an admin fixes this. No time threshold here on purpose: an
    // unassigned device silently misses billing for however long it sits
    // that way, so surfacing it immediately (rather than waiting for it to
    // "age") is the point.
    for (const d of unassignedDevices) {
      const deviceName = d.customLabel ?? d.printerName ?? d.name ?? d.host;
      items.push({
        type: 'UNASSIGNED_DEVICE',
        dedupeKey: `unassigned-device:${d.id}`,
        title: `Dispositivo sem cliente: ${deviceName}`,
        body: `${d.host}${d.serialNumber ? ` · nº série ${d.serialNumber}` : ''} - atribua um cliente para que este dispositivo entre no faturamento.`,
      });
    }

    return items;
  }

  // The core "don't alert me about the same thing every day" logic: upsert
  // by dedupeKey. A currently-detected issue that's already an unresolved
  // row just gets its content refreshed (readAt untouched, so it doesn't
  // pop back to "unread"). A currently-detected issue that's a RESOLVED row
  // is left alone - that's the whole point, someone already dealt with it.
  // A row that's unresolved but no longer detected auto-resolves itself
  // (the real problem went away on its own - paid, renewed, replaced).
  async syncNotifications(tenantId: string): Promise<{ created: number; updated: number; autoResolved: number }> {
    const current = await this.collectCurrentAlerts(tenantId);
    const currentKeys = new Set(current.map((i) => i.dedupeKey));

    const existing = await this.prisma.notification.findMany({
      where: { tenantId },
      select: { dedupeKey: true, resolvedAt: true },
    });
    const existingByKey = new Map(existing.map((n) => [n.dedupeKey, n]));

    let created = 0;
    let updated = 0;

    for (const item of current) {
      const row = existingByKey.get(item.dedupeKey);
      if (!row) {
        await this.prisma.notification.create({
          data: { tenantId, type: item.type, dedupeKey: item.dedupeKey, title: item.title, body: item.body },
        });
        created++;
      } else if (!row.resolvedAt) {
        await this.prisma.notification.update({
          where: { tenantId_dedupeKey: { tenantId, dedupeKey: item.dedupeKey } },
          data: { title: item.title, body: item.body },
        });
        updated++;
      }
      // resolved rows: leave untouched, even if still detected.
    }

    const goneKeys = existing.filter((n) => !n.resolvedAt && !currentKeys.has(n.dedupeKey)).map((n) => n.dedupeKey);
    let autoResolved = 0;
    if (goneKeys.length > 0) {
      const result = await this.prisma.notification.updateMany({
        where: { tenantId, dedupeKey: { in: goneKeys }, resolvedAt: null },
        data: { resolvedAt: new Date() },
      });
      autoResolved = result.count;
    }

    return { created, updated, autoResolved };
  }

  async resolve(tenantId: string, id: string): Promise<Notification> {
    const notification = await this.prisma.notification.findFirst({ where: { id, tenantId } });
    if (!notification) {
      throw new NotFoundException('notification not found');
    }
    return this.prisma.notification.update({ where: { id }, data: { resolvedAt: new Date() } });
  }
}
