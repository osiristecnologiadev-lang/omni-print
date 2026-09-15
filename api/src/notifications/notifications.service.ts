import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Notification, NotificationType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { InvoicesService } from '../invoices/invoices.service';
import { DevicesService } from '../devices/devices.service';
import { TicketsService } from '../tickets/tickets.service';
import { EmailService } from '../email/email.service';

function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return '';
  return new Date(d).toLocaleDateString('pt-BR', { timeZone: 'UTC' });
}

const TYPE_LABEL: Record<NotificationType, string> = {
  OVERDUE_INVOICE: 'Fatura vencida',
  EXPIRING_CONTRACT: 'Contrato',
  CRITICAL_DEVICE_ALERT: 'Dispositivo',
  LOW_SUPPLY: 'Suprimento',
  UNASSIGNED_DEVICE: 'Sem cliente',
  TICKET_SLA_BREACH: 'Chamado',
};

// The only two categories a tenant's own CLIENT can ever be emailed about
// (Customer.notifyEmail) - never billing/contract categories, and never
// configurable wider than this, see the schema comment on
// Customer.notifyEmail for why this boundary is fixed, not a preference.
const CUSTOMER_NOTIFIABLE_TYPES: NotificationType[] = ['CRITICAL_DEVICE_ALERT', 'LOW_SUPPLY'];

interface CurrentAlert {
  type: NotificationType;
  dedupeKey: string;
  title: string;
  body: string;
  // App path to the thing this notification is about - see the schema
  // comment on Notification.linkHref.
  linkHref: string;
  // Which of the tenant's own clients this is about, if any - see the
  // schema comment on Notification.customerId.
  customerId: string | null;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly invoicesService: InvoicesService,
    private readonly devicesService: DevicesService,
    private readonly ticketsService: TicketsService,
    private readonly emailService: EmailService,
  ) {}

  // Runs nightly, after invoice generation (2am) so an invoice that just
  // became overdue is already reflected - see InvoicesService.generateDueInvoices.
  // Also callable on demand (POST /v1/notifications/sync) so a tenant admin
  // can refresh without waiting for the cron - that manual path never
  // emails (sendEmail defaults false, see syncNotifications), only this
  // cron does, so email volume is capped at once per tenant per day
  // regardless of how many times someone clicks "Atualizar agora".
  @Cron(CronExpression.EVERY_DAY_AT_7AM)
  async syncAllTenants(): Promise<void> {
    const tenants = await this.prisma.tenant.findMany({ select: { id: true } });
    for (const tenant of tenants) {
      try {
        await this.syncNotifications(tenant.id, { sendEmail: true });
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
    const [billingAlerts, activeAlerts, lowSupplies, unassignedDevices, breachedTickets] = await Promise.all([
      this.invoicesService.alerts(tenantId),
      this.devicesService.activeAlerts(tenantId, null),
      this.devicesService.lowSupplyForecast(tenantId, null, 14, 90),
      this.devicesService.listUnassigned(tenantId),
      this.ticketsService.slaBreached(tenantId),
    ]);
    const criticalDeviceAlerts = activeAlerts.filter((a) => a.severity === 'critical');

    const items: CurrentAlert[] = [];

    for (const inv of billingAlerts.overdueInvoices) {
      items.push({
        type: 'OVERDUE_INVOICE',
        dedupeKey: `invoice:${inv.id}`,
        title: `Fatura vencida: ${inv.customer.name}`,
        body: `Vencida em ${fmtDate(inv.dueDate)}, R$ ${Number(inv.totalDue).toFixed(2)}.`,
        // No per-invoice detail page exists (only a list per customer) -
        // the list is the closest real destination.
        linkHref: `/customers/${inv.customerId}/invoices`,
        customerId: inv.customerId,
      });
    }

    for (const c of billingAlerts.expiringContracts) {
      items.push({
        type: 'EXPIRING_CONTRACT',
        dedupeKey: `contract:${c.id}`,
        title: `Contrato próximo do fim: ${c.customer.name}`,
        body: `Vence em ${fmtDate(c.endDate)}.`,
        linkHref: `/customers/${c.customerId}/contract`,
        customerId: c.customerId,
      });
    }

    for (const a of criticalDeviceAlerts) {
      items.push({
        type: 'CRITICAL_DEVICE_ALERT',
        dedupeKey: `device-alert:${a.deviceId}:${a.code ?? a.description ?? 'critical'}`,
        title: `Alerta crítico: ${a.deviceName}`,
        body: a.description ?? 'Alerta crítico reportado pelo dispositivo.',
        linkHref: `/devices/${a.deviceId}`,
        customerId: a.customerId,
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
        linkHref: `/devices/${s.deviceId}`,
        customerId: s.customerId,
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
        linkHref: `/devices/${d.id}`,
        customerId: null, // by definition - that's the whole point of this notification type
      });
    }

    for (const t of breachedTickets) {
      items.push({
        type: 'TICKET_SLA_BREACH',
        dedupeKey: `ticket-sla:${t.id}`,
        title: `Chamado com SLA estourado: ${t.subject}`,
        body: `${t.customer.name} · prazo era ${fmtDate(t.slaDueAt)}.`,
        linkHref: `/tickets/${t.id}`,
        // Never reaches CUSTOMER_NOTIFIABLE_TYPES - this is a "we're
        // breaching our own promise" signal for staff, not the customer -
        // but customerId is still recorded for consistency/future audit
        // filtering, same as OVERDUE_INVOICE/EXPIRING_CONTRACT above.
        customerId: t.customerId,
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
  async syncNotifications(
    tenantId: string,
    opts: { sendEmail?: boolean } = {},
  ): Promise<{ created: number; updated: number; autoResolved: number }> {
    const current = await this.collectCurrentAlerts(tenantId);
    const currentKeys = new Set(current.map((i) => i.dedupeKey));

    const existing = await this.prisma.notification.findMany({
      where: { tenantId },
      select: { dedupeKey: true, resolvedAt: true },
    });
    const existingByKey = new Map(existing.map((n) => [n.dedupeKey, n]));

    let created = 0;
    let updated = 0;
    const newlyCreated: CurrentAlert[] = [];

    for (const item of current) {
      const row = existingByKey.get(item.dedupeKey);
      if (!row) {
        await this.prisma.notification.create({
          data: {
            tenantId,
            type: item.type,
            dedupeKey: item.dedupeKey,
            title: item.title,
            body: item.body,
            linkHref: item.linkHref,
            customerId: item.customerId,
          },
        });
        created++;
        newlyCreated.push(item);
      } else if (!row.resolvedAt) {
        await this.prisma.notification.update({
          where: { tenantId_dedupeKey: { tenantId, dedupeKey: item.dedupeKey } },
          data: { title: item.title, body: item.body, linkHref: item.linkHref, customerId: item.customerId },
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

    // Email only about what's genuinely NEW this run, never a rehash of
    // still-open items - same "don't re-alert about something already
    // known to be true" principle the dedupe logic above already applies
    // to the in-app list (see that block's own comment). Also only ever
    // from the cron (opts.sendEmail) - see syncAllTenants's comment on why
    // the on-demand sync path never triggers this.
    if (opts.sendEmail && newlyCreated.length > 0) {
      await this.sendDigestEmail(tenantId, newlyCreated);
    }

    return { created, updated, autoResolved };
  }

  async getEmailPreferences(tenantId: string): Promise<{ emailEnabled: boolean; emailTypes: NotificationType[] }> {
    const tenant = await this.prisma.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { notifyEmailEnabled: true, notifyEmailTypes: true },
    });
    return { emailEnabled: tenant.notifyEmailEnabled, emailTypes: tenant.notifyEmailTypes };
  }

  updateEmailPreferences(
    tenantId: string,
    prefs: { emailEnabled: boolean; emailTypes: NotificationType[] },
  ): Promise<{ emailEnabled: boolean; emailTypes: NotificationType[] }> {
    return this.prisma.tenant
      .update({
        where: { id: tenantId },
        data: { notifyEmailEnabled: prefs.emailEnabled, notifyEmailTypes: prefs.emailTypes },
        select: { notifyEmailEnabled: true, notifyEmailTypes: true },
      })
      .then((t) => ({ emailEnabled: t.notifyEmailEnabled, emailTypes: t.notifyEmailTypes }));
  }

  private async sendDigestEmail(tenantId: string, items: CurrentAlert[]): Promise<void> {
    const prefs = await this.getEmailPreferences(tenantId);
    if (!prefs.emailEnabled) return;

    // Staff digest - whichever categories the tenant opted into, tenant-wide.
    const forStaff = items.filter((i) => prefs.emailTypes.includes(i.type));
    if (forStaff.length > 0) {
      const recipients = await this.prisma.user.findMany({
        where: { tenantId, revokedAt: null, permissions: { has: 'notifications' } },
        select: { email: true },
      });
      if (recipients.length > 0) {
        await this.emailService.send({ to: recipients.map((r) => r.email), ...this.buildDigest(forStaff) });
      }
    }

    // Per-customer digest - a completely separate, fixed-category channel
    // (see CUSTOMER_NOTIFIABLE_TYPES) independent of the staff categories
    // above: a client can be told about their own critical alerts even if
    // staff themselves didn't opt into that category, and vice versa.
    // Still gated by the same tenant-wide emailEnabled master switch above.
    const forCustomers = items.filter((i) => i.customerId && CUSTOMER_NOTIFIABLE_TYPES.includes(i.type));
    if (forCustomers.length === 0) return;

    const customerIds = [...new Set(forCustomers.map((i) => i.customerId as string))];
    const customers = await this.prisma.customer.findMany({
      where: { id: { in: customerIds }, notifyEmail: { not: null } },
      select: { id: true, notifyEmail: true },
    });

    for (const customer of customers) {
      const theirItems = forCustomers.filter((i) => i.customerId === customer.id);
      await this.emailService.send({
        to: customer.notifyEmail as string,
        ...this.buildDigest(theirItems, { withAppLinks: false }),
      });
    }
  }

  // withAppLinks: false for the customer-facing channel - a Customer.
  // notifyEmail contact has no OmniPrint login at all by design (see that
  // field's schema comment), so every link this digest would otherwise
  // include (/devices/<id>, /notifications) is a dead end that just
  // redirects them to a login screen they have no credentials for.
  private buildDigest(items: CurrentAlert[], opts: { withAppLinks: boolean } = { withAppLinks: true }): {
    subject: string;
    html: string;
    text: string;
  } {
    const appUrl = process.env.APP_URL ?? 'http://localhost:3001';
    const plural = items.length === 1 ? '' : 's';
    const subject = `OmniPrint: ${items.length} novo${plural} aviso${plural}`;

    const rows = items
      .map(
        (i) => `
          <tr>
            <td style="padding:10px 0;border-bottom:1px solid #e2e5eb;">
              <div style="font-size:11px;font-weight:600;color:#57606f;text-transform:uppercase;letter-spacing:.04em;">${TYPE_LABEL[i.type]}</div>
              <div style="font-size:15px;font-weight:600;color:#14181f;margin-top:2px;">${i.title}</div>
              <div style="font-size:13.5px;color:#57606f;margin-top:2px;">${i.body}</div>
              ${opts.withAppLinks ? `<a href="${appUrl}${i.linkHref}" style="font-size:13px;color:#2547d0;text-decoration:none;">Ver detalhes →</a>` : ''}
            </td>
          </tr>`,
      )
      .join('');

    const html = `
      <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;margin:0 auto;">
        <h1 style="font-size:18px;color:#14181f;">${items.length} novo${plural} aviso${plural} no OmniPrint</h1>
        <table style="width:100%;border-collapse:collapse;">${rows}</table>
        ${
          opts.withAppLinks
            ? `<p style="margin-top:20px;"><a href="${appUrl}/notifications" style="font-size:13.5px;color:#2547d0;">Ver todas as notificações no painel →</a></p>`
            : ''
        }
      </div>`;

    const text = [
      `${items.length} novo${plural} aviso${plural} no OmniPrint:`,
      '',
      ...items.map((i) => `[${TYPE_LABEL[i.type]}] ${i.title} - ${i.body}${opts.withAppLinks ? ` (${appUrl}${i.linkHref})` : ''}`),
      ...(opts.withAppLinks ? ['', `Ver todas: ${appUrl}/notifications`] : []),
    ].join('\n');

    return { subject, html, text };
  }

  async resolve(tenantId: string, id: string): Promise<Notification> {
    const notification = await this.prisma.notification.findFirst({ where: { id, tenantId } });
    if (!notification) {
      throw new NotFoundException('notification not found');
    }
    return this.prisma.notification.update({ where: { id }, data: { resolvedAt: new Date() } });
  }
}
