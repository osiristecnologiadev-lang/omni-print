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
          periodStart: { gte: new Date('2026-07-01T00:00:00.000Z') },
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
        periodStart: new Date('2026-07-01T00:00:00Z'),
        totalDue: '100.00',
        status: 'PENDING',
        totalPages: 500,
      }),
      makeInvoice({
        customerId: 'a',
        customer: { id: 'a', name: 'Customer A' },
        periodStart: new Date('2026-08-01T00:00:00Z'),
        totalDue: '150.00',
        paidAmount: '150.00',
        status: 'PAID',
        totalPages: 600,
      }),
      makeInvoice({
        customerId: 'b',
        customer: { id: 'b', name: 'Customer B' },
        periodStart: new Date('2026-08-01T00:00:00Z'),
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
