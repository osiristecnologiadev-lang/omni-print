// The nightly invoice job (InvoicesService.generateDueInvoices) against a
// real database: each customer gets exactly one invoice for its last
// CLOSED period, following its own closing day; nothing for a period no
// contract covers; running it again changes nothing.
import { ContractPricingModel } from '@prisma/client';
import { lastClosedCycle, cyclePeriod } from '../src/common/billing-cycle.util';
import { connect, customer, device, reading, reset, tenant } from './db';

const { prisma, contracts, invoices } = connect();

beforeEach(() => reset(prisma));
afterAll(() => prisma.$disconnect());

async function flatContract(tenantId: string, customerId: string, startDate: string) {
  return contracts.create(tenantId, customerId, {
    pricingModel: ContractPricingModel.FLAT_RATE,
    fixedFee: 900,
    startDate,
    billingDay: 10,
  } as never);
}

describe('Geração automática de faturas', () => {
  it('bills each customer\'s last closed period on its own closing day, once', async () => {
    const t = await tenant(prisma);
    const day1 = await customer(prisma, t.id, 1);
    const day28 = await customer(prisma, t.id, 28);
    await flatContract(t.id, day1.id, '2026-01-01');
    await flatContract(t.id, day28.id, '2026-01-01');
    for (const c of [day1, day28]) {
      const d = await device(prisma, t.id, c.id, `10.1.${c.billingCycleDay}.1`);
      await reading(prisma, d.id, '2026-01-02T12:00:00Z', 1_000);
    }

    await invoices.generateDueInvoices();
    await invoices.generateDueInvoices(); // idempotent

    const now = new Date();
    for (const c of [day1, day28]) {
      const { year, month } = lastClosedCycle(now, c.billingCycleDay);
      const expected = cyclePeriod(year, month, c.billingCycleDay);
      const list = await prisma.invoice.findMany({ where: { customerId: c.id } });
      expect(list).toHaveLength(1);
      expect(list[0].periodStart.toISOString()).toBe(expected.periodStart.toISOString());
      expect(Number(list[0].totalDue)).toBeCloseTo(900, 2);
      expect(list[0].periodEnd.getTime()).toBeLessThan(now.getTime()); // never an open period
    }
  });

  it('skips a customer whose contract only starts after that period', async () => {
    const t = await tenant(prisma);
    const c = await customer(prisma, t.id, 1);
    const future = new Date(Date.now() + 40 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    await flatContract(t.id, c.id, future);

    await invoices.generateDueInvoices();
    expect(await prisma.invoice.count({ where: { customerId: c.id } })).toBe(0);
  });

  it('does not re-create an invoice that was cancelled (only an explicit regenerate does)', async () => {
    const t = await tenant(prisma);
    const c = await customer(prisma, t.id, 1);
    await flatContract(t.id, c.id, '2026-01-01');
    await invoices.generateDueInvoices();
    const inv = await prisma.invoice.findFirstOrThrow({ where: { customerId: c.id } });
    await invoices.cancel(t.id, c.id, inv.id);

    await invoices.generateDueInvoices();
    const after = await prisma.invoice.findMany({ where: { customerId: c.id } });
    expect(after).toHaveLength(1);
    expect(after[0].status).toBe('CANCELLED');
  });

  it('marking paid records the amount and date', async () => {
    const t = await tenant(prisma);
    const c = await customer(prisma, t.id, 1);
    await flatContract(t.id, c.id, '2026-01-01');
    await invoices.generateDueInvoices();
    const inv = await prisma.invoice.findFirstOrThrow({ where: { customerId: c.id } });

    await invoices.markPaid(t.id, c.id, inv.id, 850);
    const paid = await prisma.invoice.findUniqueOrThrow({ where: { id: inv.id } });
    expect(paid.status).toBe('PAID');
    expect(Number(paid.paidAmount)).toBeCloseTo(850, 2);
    expect(paid.paidAt).not.toBeNull();
  });
});
