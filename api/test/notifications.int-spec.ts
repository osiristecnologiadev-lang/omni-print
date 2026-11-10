// The daily notification sync against a real database: an alert appears
// once, updates instead of duplicating, resolves itself when the problem
// goes away, stays resolved when a person resolved it, and opens a ticket
// automatically only when the tenant asked for it.
import { ContractPricingModel } from '@prisma/client';
import { connect, customer, reset, tenant } from './db';

const { prisma, contracts, invoices, notifications } = connect();
delete process.env.RESEND_API_KEY;

beforeEach(() => reset(prisma));
afterAll(() => prisma.$disconnect());

async function overdueInvoice() {
  const t = await tenant(prisma);
  const c = await customer(prisma, t.id, 1);
  await contracts.create(t.id, c.id, { pricingModel: ContractPricingModel.FLAT_RATE, fixedFee: 700, startDate: '2026-01-01', billingDay: 5 } as never);
  // A closed month whose due date (day 5 of the next month) is long past.
  const inv = await invoices.generate(t.id, c.id, 2026, 6);
  return { t, c, inv };
}

describe('Notificações automáticas', () => {
  it('an overdue invoice creates one notification; a second sync does not duplicate it', async () => {
    const { t } = await overdueInvoice();
    const first = await notifications.syncNotifications(t.id);
    const second = await notifications.syncNotifications(t.id);
    const rows = await prisma.notification.findMany({ where: { tenantId: t.id, type: 'OVERDUE_INVOICE' } });
    expect(rows).toHaveLength(1);
    expect(first.created).toBeGreaterThanOrEqual(1);
    expect(second.created).toBe(0);
  });

  it('resolves itself once the invoice is paid', async () => {
    const { t, c, inv } = await overdueInvoice();
    await notifications.syncNotifications(t.id);
    await invoices.markPaid(t.id, c.id, inv.id);
    const r = await notifications.syncNotifications(t.id);
    expect(r.autoResolved).toBeGreaterThanOrEqual(1);
    const row = await prisma.notification.findFirstOrThrow({ where: { tenantId: t.id, type: 'OVERDUE_INVOICE' } });
    expect(row.resolvedAt).not.toBeNull();
  });

  it('stays resolved when a person resolved it, even if the problem is still there', async () => {
    const { t } = await overdueInvoice();
    await notifications.syncNotifications(t.id);
    const n = await prisma.notification.findFirstOrThrow({ where: { tenantId: t.id, type: 'OVERDUE_INVOICE' } });
    await notifications.resolve(t.id, n.id);
    await notifications.syncNotifications(t.id);
    const rows = await prisma.notification.findMany({ where: { tenantId: t.id, type: 'OVERDUE_INVOICE' } });
    expect(rows).toHaveLength(1);
    expect(rows[0].resolvedAt).not.toBeNull();
  });

  it('a printer to review raises a DEVICE_REVIEW notification', async () => {
    const t = await tenant(prisma);
    const c = await customer(prisma, t.id, 1);
    await prisma.device.create({ data: { tenantId: t.id, customerId: c.id, host: '10.9.9.9', billingExcluded: true, reviewPending: true } });
    await notifications.syncNotifications(t.id);
    expect(await prisma.notification.count({ where: { tenantId: t.id, type: 'DEVICE_REVIEW' } })).toBe(1);
  });

  it('opens a ticket automatically only when the tenant turned it on for that kind of alert, once', async () => {
    const { t, c } = await overdueInvoice();
    await notifications.syncNotifications(t.id);
    expect(await prisma.ticket.count({ where: { tenantId: t.id } })).toBe(0); // off by default

    await prisma.notification.deleteMany({ where: { tenantId: t.id } });
    await notifications.updateTicketAutomationPreferences(t.id, { autoTicketEnabled: true, autoTicketTypes: ['OVERDUE_INVOICE'] });
    await notifications.syncNotifications(t.id);
    await notifications.syncNotifications(t.id);
    const tickets = await prisma.ticket.findMany({ where: { tenantId: t.id } });
    expect(tickets).toHaveLength(1);
    expect(tickets[0].customerId).toBe(c.id);
  });
});
