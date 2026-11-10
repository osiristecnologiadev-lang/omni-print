// Billing against a real Postgres+TimescaleDB: customers, contracts,
// printers and readings go into the database, the real services compute
// the bill. Each expected value is worked out by hand in the test, so a
// regression in the money math fails here before it reaches a customer.
import { ContractPricingModel } from '@prisma/client';
import { connect, customer, device, reading, reset, tenant } from './db';

const { prisma, contracts, invoices, devices } = connect();

beforeEach(() => reset(prisma));
afterAll(() => prisma.$disconnect());

async function contract(tenantId: string, customerId: string, dto: Record<string, unknown>) {
  return contracts.create(tenantId, customerId, {
    startDate: '2026-08-01',
    billingDay: 10,
    ...dto,
  } as never);
}

describe('Mínimo por impressora (PER_DEVICE_MINIMUM)', () => {
  it('each printer pays max(minimum, pages x price); printers fora do contrato pay nothing', async () => {
    const t = await tenant(prisma);
    const c = await customer(prisma, t.id, 1);
    await contract(t.id, c.id, {
      pricingModel: ContractPricingModel.PER_DEVICE_MINIMUM,
      pricePerPageMono: 0.042,
      pricePerPageColor: 0.042,
      minimumChargePerDevice: 250,
    });
    const busy = await device(prisma, t.id, c.id, '10.0.0.1');
    const quiet = await device(prisma, t.id, c.id, '10.0.0.2');
    const outside = await device(prisma, t.id, c.id, '10.0.0.3', { billingExcluded: true });

    // September: busy 10.000 págs (R$ 420 > 250), quiet 1.000 (R$ 42 -> pays 250), outside 50.000 (not billed).
    await reading(prisma, busy.id, '2026-08-31T12:00:00Z', 100_000);
    await reading(prisma, busy.id, '2026-09-30T12:00:00Z', 110_000);
    await reading(prisma, quiet.id, '2026-08-31T12:00:00Z', 5_000);
    await reading(prisma, quiet.id, '2026-09-30T12:00:00Z', 6_000);
    await reading(prisma, outside.id, '2026-08-31T12:00:00Z', 0 + 1);
    await reading(prisma, outside.id, '2026-09-30T12:00:00Z', 50_001);

    const bill = await contracts.calculateBilling(t.id, c.id, 2026, 9);
    if (!bill.hasContract) throw new Error('expected a contract');
    expect(bill.totalPages).toBe(11_000);
    expect(bill.totalDue).toBeCloseTo(420 + 250, 2);
    expect(bill.perDevice.map((d) => d.deviceId).sort()).toEqual([busy.id, quiet.id].sort());
  });

  it('a printer with its own minimum uses it instead of the contract one', async () => {
    const t = await tenant(prisma);
    const c = await customer(prisma, t.id, 1);
    await contract(t.id, c.id, {
      pricingModel: ContractPricingModel.PER_DEVICE_MINIMUM,
      pricePerPageMono: 0.042,
      pricePerPageColor: 0.042,
      minimumChargePerDevice: 250,
    });
    const d = await device(prisma, t.id, c.id, '10.0.0.1', { minimumChargeOverride: 100 });
    await reading(prisma, d.id, '2026-08-31T12:00:00Z', 1_000);
    await reading(prisma, d.id, '2026-09-30T12:00:00Z', 1_500);

    const bill = await contracts.calculateBilling(t.id, c.id, 2026, 9);
    if (!bill.hasContract) throw new Error('expected a contract');
    expect(bill.totalDue).toBeCloseTo(100, 2); // 500 x 0,042 = 21 < its own 100
  });
});

describe('Por página (PER_PAGE)', () => {
  it('bills mono and color apart, with a printer-specific color price, on a day-28 cycle', async () => {
    const t = await tenant(prisma);
    const c = await customer(prisma, t.id, 28);
    await contract(t.id, c.id, {
      pricingModel: ContractPricingModel.PER_PAGE,
      pricePerPageMono: 0.06,
      pricePerPageColor: 0.95,
      minimumPagesMono: 0,
      minimumPagesColor: 0,
    });
    const mono = await device(prisma, t.id, c.id, '10.0.0.1');
    const color = await device(prisma, t.id, c.id, '10.0.0.2', { colorPagePriceOverride: 0.75 });

    // "October" on day 28 = 28/09 00:00 .. 27/10 23:59:59.999.
    await reading(prisma, mono.id, '2026-09-27T12:00:00Z', 10_000);
    await reading(prisma, mono.id, '2026-10-27T12:00:00Z', 12_000); // +2.000 mono
    await reading(prisma, color.id, '2026-09-27T12:00:00Z', 3_000, { mono: 2_000, color: 1_000 });
    await reading(prisma, color.id, '2026-10-27T12:00:00Z', 3_600, { mono: 2_400, color: 1_200 }); // +400 mono, +200 color
    // After the period: must not count.
    await reading(prisma, mono.id, '2026-10-29T12:00:00Z', 99_000);

    const bill = await contracts.calculateBilling(t.id, c.id, 2026, 10);
    if (!bill.hasContract) throw new Error('expected a contract');
    expect(bill.periodStart.toISOString()).toBe('2026-09-28T00:00:00.000Z');
    expect(bill.monoPages).toBe(2_400);
    expect(bill.colorPages).toBe(200);
    // 2.400 x 0,06 + 200 x 0,75 (its own color price, not the contract's 0,95)
    expect(bill.totalDue).toBeCloseTo(144 + 150, 2);
  });

  it('charges the monthly minimum when the customer prints less', async () => {
    const t = await tenant(prisma);
    const c = await customer(prisma, t.id, 1);
    await contract(t.id, c.id, {
      pricingModel: ContractPricingModel.PER_PAGE,
      pricePerPageMono: 0.05,
      pricePerPageColor: 0.5,
      minimumPagesMono: 5_000,
      minimumPagesColor: 0,
      fixedFee: 100,
    });
    const d = await device(prisma, t.id, c.id, '10.0.0.1');
    await reading(prisma, d.id, '2026-08-31T12:00:00Z', 1_000);
    await reading(prisma, d.id, '2026-09-30T12:00:00Z', 2_000);

    const bill = await contracts.calculateBilling(t.id, c.id, 2026, 9);
    if (!bill.hasContract) throw new Error('expected a contract');
    expect(bill.totalDue).toBeCloseTo(100 + 5_000 * 0.05, 2); // taxa fixa + mínimo
  });

  it('keeps a 5-decimal price exactly (0,04725 used to be stored as 0,0473)', async () => {
    const t = await tenant(prisma);
    const c = await customer(prisma, t.id, 1);
    await contract(t.id, c.id, {
      pricingModel: ContractPricingModel.PER_PAGE,
      pricePerPageMono: 0.04725,
      pricePerPageColor: 0.75,
      minimumPagesMono: 0,
      minimumPagesColor: 0,
    });
    const d = await device(prisma, t.id, c.id, '10.0.0.1');
    await reading(prisma, d.id, '2026-08-31T12:00:00Z', 100_000);
    await reading(prisma, d.id, '2026-09-30T12:00:00Z', 163_420);

    const bill = await contracts.calculateBilling(t.id, c.id, 2026, 9);
    if (!bill.hasContract) throw new Error('expected a contract');
    // 63.420 x 0,04725 = 2.996,595 -> R$ 2.996,60, rounded in the bill itself
    // (same as the invoice column), not left unrounded.
    expect(bill.totalDue).toBe(2_996.6);
  });
});

describe('Franquia com excedente (ALLOWANCE_PLUS_OVERAGE)', () => {
  it('only pages beyond the allowance are charged on top of the monthly fee', async () => {
    const t = await tenant(prisma);
    const c = await customer(prisma, t.id, 1);
    await contract(t.id, c.id, {
      pricingModel: ContractPricingModel.ALLOWANCE_PLUS_OVERAGE,
      fixedFee: 450,
      includedPagesMono: 5_000,
      includedPagesColor: 500,
      overagePriceMono: 0.08,
      overagePriceColor: 0.35,
    });
    const d = await device(prisma, t.id, c.id, '10.0.0.1');
    await reading(prisma, d.id, '2026-08-31T12:00:00Z', 1_000, { mono: 900, color: 100 });
    await reading(prisma, d.id, '2026-09-30T12:00:00Z', 11_600, { mono: 10_900, color: 700 });

    const bill = await contracts.calculateBilling(t.id, c.id, 2026, 9);
    if (!bill.hasContract) throw new Error('expected a contract');
    // 450 + (10.000 - 5.000) x 0,08 + (600 - 500) x 0,35
    expect(bill.totalDue).toBeCloseTo(885, 2);
  });
});

describe('Mensalidade fixa (FLAT_RATE)', () => {
  it('is the fee, whatever was printed', async () => {
    const t = await tenant(prisma);
    const c = await customer(prisma, t.id, 1);
    await contract(t.id, c.id, { pricingModel: ContractPricingModel.FLAT_RATE, fixedFee: 1_200 });
    const d = await device(prisma, t.id, c.id, '10.0.0.1');
    await reading(prisma, d.id, '2026-08-31T12:00:00Z', 0 + 10);
    await reading(prisma, d.id, '2026-09-30T12:00:00Z', 90_010);

    const bill = await contracts.calculateBilling(t.id, c.id, 2026, 9);
    if (!bill.hasContract) throw new Error('expected a contract');
    expect(bill.totalDue).toBeCloseTo(1_200, 2);
    expect(bill.totalPages).toBe(90_000);
  });
});

describe('Leitura inicial manual', () => {
  it('bills from the manual baseline when monitoring started mid-period', async () => {
    const t = await tenant(prisma);
    const c = await customer(prisma, t.id, 1);
    await contract(t.id, c.id, {
      pricingModel: ContractPricingModel.PER_PAGE,
      pricePerPageMono: 0.05,
      pricePerPageColor: 0.5,
      minimumPagesMono: 0,
      minimumPagesColor: 0,
    });
    const d = await device(prisma, t.id, c.id, '10.0.0.1', {
      manualBaselineDate: new Date('2026-09-01T00:00:00Z'),
      manualBaselinePageCount: 200_000n,
    });
    // The agent only saw it from the 15th.
    await reading(prisma, d.id, '2026-09-15T12:00:00Z', 205_000);
    await reading(prisma, d.id, '2026-09-30T12:00:00Z', 210_000);

    const bill = await contracts.calculateBilling(t.id, c.id, 2026, 9);
    if (!bill.hasContract) throw new Error('expected a contract');
    expect(bill.totalPages).toBe(10_000);
    expect(bill.perDevice[0].usedManualBaseline).toBe(true);
  });
});

describe('Faturas', () => {
  it('generates the closed month once (a second call returns the same invoice) and refuses an open period', async () => {
    const t = await tenant(prisma);
    const c = await customer(prisma, t.id, 1);
    await contract(t.id, c.id, { pricingModel: ContractPricingModel.FLAT_RATE, fixedFee: 1_200, billingDay: 15 });
    const d = await device(prisma, t.id, c.id, '10.0.0.1');
    await reading(prisma, d.id, '2026-08-31T12:00:00Z', 10);
    await reading(prisma, d.id, '2026-09-30T12:00:00Z', 20);

    const first = await invoices.generate(t.id, c.id, 2026, 9);
    const second = await invoices.generate(t.id, c.id, 2026, 9);
    expect(second.id).toBe(first.id);
    expect(Number(first.totalDue)).toBeCloseTo(1_200, 2);
    expect(first.dueDate.toISOString().slice(0, 10)).toBe('2026-10-15');

    const now = new Date();
    await expect(invoices.generate(t.id, c.id, now.getUTCFullYear(), now.getUTCMonth() + 1)).rejects.toThrow(/not closed/);

    const all = await invoices.listAll(t.id, { year: 2026, month: 9 });
    expect(all).toHaveLength(1);
    expect(all[0].customer.name).toBe(c.name);
  });
});

describe('Contratos (visão geral)', () => {
  it('counts billed / outside / to-review printers and those without a recent reading', async () => {
    const t = await tenant(prisma);
    const c = await customer(prisma, t.id, 1);
    const none = await customer(prisma, t.id, 1);
    await contract(t.id, c.id, { pricingModel: ContractPricingModel.FLAT_RATE, fixedFee: 500 });
    const fresh = await device(prisma, t.id, c.id, '10.0.0.1');
    await device(prisma, t.id, c.id, '10.0.0.2'); // billed, never read
    await prisma.device.create({
      data: { tenantId: t.id, customerId: c.id, host: '10.0.0.3', billingExcluded: true, reviewPending: true },
    });
    await reading(prisma, fresh.id, new Date().toISOString(), 1_000);

    const rows = await contracts.overview(t.id);
    const row = rows.find((r) => r.customerId === c.id)!;
    expect(row.contract?.pricingModel).toBe('FLAT_RATE');
    expect(row.devicesBilled).toBe(2);
    expect(row.devicesExcluded).toBe(1);
    expect(row.devicesToReview).toBe(1);
    expect(row.devicesWithoutReading).toBe(1);
    expect(row.current?.totalDue).toBeCloseTo(500, 2);
    expect(rows.find((r) => r.customerId === none.id)?.contract).toBeNull();
  });
});

describe('Páginas por impressora (relatório)', () => {
  it('reports start, end and pages per printer for the month, with the model', async () => {
    const t = await tenant(prisma);
    const c = await customer(prisma, t.id, 1);
    const d = await device(prisma, t.id, c.id, '10.0.0.1');
    await prisma.device.update({ where: { id: d.id }, data: { manufacturer: 'HP', model: 'LaserJet M404dn' } });
    await reading(prisma, d.id, '2026-08-31T12:00:00Z', 1_000);
    await reading(prisma, d.id, '2026-09-30T12:00:00Z', 4_000);

    const report = await devices.devicePagesReport(t.id, null, 2026, 9);
    const row = report.rows.find((r) => r.deviceId === d.id)!;
    expect(row.pages).toBe(3_000);
    expect(Number(row.startReading)).toBe(1_000);
    expect(Number(row.endReading)).toBe(4_000);
    expect(row.model).toBe('HP LaserJet M404dn');
  });
});

describe('Contador que zera no meio do período', () => {
  it('adds the pages before and after the reset and flags it', async () => {
    const t = await tenant(prisma);
    const c = await customer(prisma, t.id, 1);
    await contract(t.id, c.id, {
      pricingModel: ContractPricingModel.PER_PAGE,
      pricePerPageMono: 0.05,
      pricePerPageColor: 0.5,
      minimumPagesMono: 0,
      minimumPagesColor: 0,
    });
    const d = await device(prisma, t.id, c.id, '10.0.0.1');
    await reading(prisma, d.id, '2026-08-31T12:00:00Z', 1_000);
    await reading(prisma, d.id, '2026-09-10T12:00:00Z', 3_000); // +2.000
    await reading(prisma, d.id, '2026-09-11T12:00:00Z', 100); // board swapped: counter restarted
    await reading(prisma, d.id, '2026-09-12T12:00:00Z', 300);
    await reading(prisma, d.id, '2026-09-30T12:00:00Z', 600); // +500 after the reset

    const bill = await contracts.calculateBilling(t.id, c.id, 2026, 9);
    if (!bill.hasContract) throw new Error('expected a contract');
    expect(bill.perDevice[0].counterReset).toBe(true);
    expect(bill.totalPages).toBe(2_000 + 100 + 500);
  });
});
