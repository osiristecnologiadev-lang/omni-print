import { Test } from '@nestjs/testing';
import { InvoicesService } from './invoices.service';
import { PrismaService } from '../prisma/prisma.service';
import { ContractsService } from '../contracts/contracts.service';

function makeInvoice(overrides: Partial<Record<string, unknown>>) {
  return {
    id: 'inv-' + Math.random(),
    customerId: 'c1',
    customer: { id: 'c1', name: 'Customer A' },
    totalDue: '0',
    paidAmount: null,
    status: 'PENDING',
    totalPages: 0,
    ...overrides,
  };
}

describe('InvoicesService.usageRevenueReport', () => {
  let service: InvoicesService;
  let prisma: { invoice: { findMany: jest.Mock } };

  beforeEach(async () => {
    prisma = { invoice: { findMany: jest.fn() } };

    const moduleRef = await Test.createTestingModule({
      providers: [
        InvoicesService,
        { provide: PrismaService, useValue: prisma },
        { provide: ContractsService, useValue: {} },
      ],
    }).compile();

    service = moduleRef.get(InvoicesService);

    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-09-15T12:00:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('queries with the correct window start and excludes cancelled invoices at the query level', async () => {
    prisma.invoice.findMany.mockResolvedValue([]);

    await service.usageRevenueReport('t1', 3);

    expect(prisma.invoice.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: 't1',
          periodEnd: { gte: new Date('2026-07-01T00:00:00.000Z') },
          status: { not: 'CANCELLED' },
        }),
      }),
    );
  });

  it('aggregates revenue/pages by month and by customer, backfilling months with no invoices', async () => {
    prisma.invoice.findMany.mockResolvedValue([
      makeInvoice({
        customerId: 'a',
        customer: { id: 'a', name: 'Customer A' },
        periodEnd: new Date('2026-07-31T23:59:59.999Z'),
        totalDue: '100.00',
        status: 'PENDING',
        totalPages: 500,
      }),
      makeInvoice({
        customerId: 'a',
        customer: { id: 'a', name: 'Customer A' },
        periodEnd: new Date('2026-08-31T23:59:59.999Z'),
        totalDue: '150.00',
        paidAmount: '150.00',
        status: 'PAID',
        totalPages: 600,
      }),
      makeInvoice({
        customerId: 'b',
        customer: { id: 'b', name: 'Customer B' },
        // closing day 28: 28/07 - 27/08 is August's invoice, not July's
        periodEnd: new Date('2026-08-27T23:59:59.999Z'),
        totalDue: '200.00',
        paidAmount: null, // PAID but no explicit paidAmount recorded - must fall back to totalDue
        status: 'PAID',
        totalPages: 300,
      }),
    ]);

    const report = await service.usageRevenueReport('t1', 3);

    // window is Jul/Aug/Sep 2026 - September has zero invoices and must
    // still appear as an explicit zero bucket, not be omitted.
    expect(report.monthly).toEqual([
      { month: '2026-07-01', totalDue: 100, paidAmount: 0, totalPages: 500 },
      { month: '2026-08-01', totalDue: 350, paidAmount: 350, totalPages: 900 },
      { month: '2026-09-01', totalDue: 0, paidAmount: 0, totalPages: 0 },
    ]);

    expect(report.totalRevenue).toBe(450);
    expect(report.totalPaid).toBe(350);
    expect(report.totalOutstanding).toBe(100); // only the PENDING invoice
    expect(report.totalPages).toBe(1400);

    expect(report.byCustomer).toEqual([
      { customerId: 'a', customerName: 'Customer A', totalDue: 250, paidAmount: 150, outstanding: 100, totalPages: 1100, invoiceCount: 2 },
      { customerId: 'b', customerName: 'Customer B', totalDue: 200, paidAmount: 200, outstanding: 0, totalPages: 300, invoiceCount: 1 },
    ]);
  });

  it('returns an all-zero report when there are no invoices at all in the window', async () => {
    prisma.invoice.findMany.mockResolvedValue([]);

    const report = await service.usageRevenueReport('t1', 2);

    expect(report.totalRevenue).toBe(0);
    expect(report.byCustomer).toEqual([]);
    expect(report.monthly).toHaveLength(2);
    expect(report.monthly.every((m) => m.totalDue === 0)).toBe(true);
  });
});

describe('InvoicesService.generate - cancelled months', () => {
  let service: InvoicesService;
  let prisma: { invoice: { findUnique: jest.Mock; update: jest.Mock; create: jest.Mock } };
  let contracts: { requireCustomer: jest.Mock; periodFor: jest.Mock; resolveBilling: jest.Mock };
  const periodStart = new Date('2026-10-01T04:00:00Z');
  const periodEnd = new Date('2026-11-01T03:59:59Z');

  beforeEach(async () => {
    prisma = { invoice: { findUnique: jest.fn(), update: jest.fn(async (a) => a), create: jest.fn(async (a) => a) } };
    contracts = {
      requireCustomer: jest.fn(async () => ({ id: 'c1' })),
      periodFor: jest.fn(async () => ({ periodStart, periodEnd })),
      resolveBilling: jest.fn(async () => ({
        hasContract: true,
        contract: { id: 'k1', billingDay: 15, pricingModel: 'PER_DEVICE_MINIMUM' },
        totalPages: 100,
        monoPages: 100,
        colorPages: 0,
        perDevice: [],
        fixedFee: 0,
        usageCost: 2793.5,
        totalDue: 2793.5,
      })),
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        InvoicesService,
        { provide: PrismaService, useValue: prisma },
        { provide: ContractsService, useValue: contracts },
      ],
    }).compile();
    service = moduleRef.get(InvoicesService);
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-11-03T18:00:00Z'));
  });

  afterEach(() => jest.useRealTimers());

  it('manual generate replaces a cancelled invoice with a fresh PENDING snapshot', async () => {
    prisma.invoice.findUnique.mockResolvedValue({ id: 'old', status: 'CANCELLED', totalDue: '3593.50' });
    await service.generate('t1', 'c1', 2026, 10, { replaceCancelled: true });
    expect(prisma.invoice.create).not.toHaveBeenCalled();
    const arg = prisma.invoice.update.mock.calls[0][0];
    expect(arg.where).toEqual({ id: 'old' });
    expect(arg.data).toMatchObject({ status: 'PENDING', totalDue: 2793.5, paidAt: null, paidAmount: null });
  });

  it('without the flag (nightly cron) a cancelled invoice stays cancelled', async () => {
    const cancelled = { id: 'old', status: 'CANCELLED' };
    prisma.invoice.findUnique.mockResolvedValue(cancelled);
    await expect(service.generate('t1', 'c1', 2026, 10)).resolves.toBe(cancelled);
    expect(prisma.invoice.update).not.toHaveBeenCalled();
    expect(contracts.resolveBilling).not.toHaveBeenCalled();
  });

  it('never replaces a PENDING or PAID invoice, even with the flag', async () => {
    for (const status of ['PENDING', 'PAID']) {
      const inv = { id: 'x', status };
      prisma.invoice.findUnique.mockResolvedValue(inv);
      await expect(service.generate('t1', 'c1', 2026, 10, { replaceCancelled: true })).resolves.toBe(inv);
    }
    expect(prisma.invoice.update).not.toHaveBeenCalled();
  });
});
