import { Test } from '@nestjs/testing';
import { ContractsService } from './contracts.service';
import { PrismaService } from '../prisma/prisma.service';

// End-to-end coverage of resolveBilling's per-pricing-model math, using the
// exact real numbers validated by hand against real customer data this
// project's session history (see roadmap memory, Item 4) - a device with
// baseline pageCount 1000/mono 700/color 300 and latest 3000/1900/1100
// under ALLOWANCE_PLUS_OVERAGE landed on R$310, and 1,339 real pages under
// PER_PAGE with a 2,000-page minimum landed on R$110. Keeping those as
// regression tests locks in numbers that were already proven correct once.

function makeDevice(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'device-1',
    printerName: 'Test Printer',
    name: null,
    host: '10.0.0.1',
    customLabel: null,
    serialNumber: 'SN1',
    manualBaselineDate: null,
    manualBaselinePageCount: null,
    ...overrides,
  };
}

describe('ContractsService.resolveBilling', () => {
  let service: ContractsService;
  let prisma: {
    contract: { findFirst: jest.Mock };
    device: { findMany: jest.Mock };
    metric: { findFirst: jest.Mock; findMany: jest.Mock };
  };

  const periodStart = new Date('2026-09-01T00:00:00Z');
  const periodEnd = new Date('2026-09-30T23:59:59.999Z');

  beforeEach(async () => {
    prisma = {
      contract: { findFirst: jest.fn() },
      device: { findMany: jest.fn() },
      metric: { findFirst: jest.fn(), findMany: jest.fn() },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [ContractsService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = moduleRef.get(ContractsService);
  });

  it('returns hasContract: false when nothing covers the period', async () => {
    prisma.contract.findFirst.mockResolvedValue(null);

    const result = await service.resolveBilling('t1', 'c1', periodStart, periodEnd);

    expect(result).toEqual({ hasContract: false, periodStart, periodEnd });
  });

  it('FLAT_RATE ignores page count entirely', async () => {
    prisma.contract.findFirst.mockResolvedValue({
      pricingModel: 'FLAT_RATE',
      fixedFee: '999.90',
    });
    prisma.device.findMany.mockResolvedValue([makeDevice()]);
    prisma.metric.findFirst.mockResolvedValue({ pageCount: BigInt(50000), monoPageCount: null, colorPageCount: null });
    prisma.metric.findMany.mockResolvedValue([{ collectedAt: periodEnd, pageCount: BigInt(99999), monoPageCount: null, colorPageCount: null }]);

    const result = await service.resolveBilling('t1', 'c1', periodStart, periodEnd);

    expect(result.hasContract).toBe(true);
    if (result.hasContract) {
      expect(result.usageCost).toBe(0);
      expect(result.totalDue).toBe(999.9);
    }
  });

  it('ALLOWANCE_PLUS_OVERAGE bills mono/color overage separately - real validated scenario (R$310)', async () => {
    prisma.contract.findFirst.mockResolvedValue({
      pricingModel: 'ALLOWANCE_PLUS_OVERAGE',
      fixedFee: '200',
      includedPagesMono: 1000,
      includedPagesColor: 500,
      overagePriceMono: '0.10',
      overagePriceColor: '0.30',
    });
    prisma.device.findMany.mockResolvedValue([makeDevice()]);
    prisma.metric.findFirst.mockResolvedValue({
      collectedAt: new Date('2026-08-31T00:00:00Z'),
      pageCount: BigInt(1000),
      monoPageCount: BigInt(700),
      colorPageCount: BigInt(300),
    });
    prisma.metric.findMany.mockResolvedValue([
      {
        collectedAt: periodEnd,
        pageCount: BigInt(3000),
        monoPageCount: BigInt(1900),
        colorPageCount: BigInt(1100),
      },
    ]);

    const result = await service.resolveBilling('t1', 'c1', periodStart, periodEnd);

    expect(result.hasContract).toBe(true);
    if (result.hasContract) {
      expect(result.monoPages).toBe(1200);
      expect(result.colorPages).toBe(800);
      expect(result.overagePages).toBe(500); // 200 mono over + 300 color over
      expect(result.usageCost).toBeCloseTo(110, 5); // 200*0.10 + 300*0.30
      expect(result.totalDue).toBeCloseTo(310, 5);
    }
  });

  it('PER_PAGE floors to the guaranteed minimum - real validated scenario (R$110)', async () => {
    prisma.contract.findFirst.mockResolvedValue({
      pricingModel: 'PER_PAGE',
      fixedFee: '50',
      pricePerPageMono: '0.03',
      pricePerPageColor: '0.03',
      minimumPagesMono: 2000,
      minimumPagesColor: 0,
    });
    prisma.device.findMany.mockResolvedValue([makeDevice()]);
    prisma.metric.findFirst.mockResolvedValue({
      collectedAt: new Date('2026-08-31T00:00:00Z'),
      pageCount: BigInt(10000),
      monoPageCount: null,
      colorPageCount: null,
    });
    prisma.metric.findMany.mockResolvedValue([
      { collectedAt: periodEnd, pageCount: BigInt(10000 + 1339), monoPageCount: null, colorPageCount: null },
    ]);

    const result = await service.resolveBilling('t1', 'c1', periodStart, periodEnd);

    expect(result.hasContract).toBe(true);
    if (result.hasContract) {
      expect(result.totalPages).toBe(1339);
      expect(result.billablePages).toBe(2000); // floored to the minimum, real pages (1339) were below it
      expect(result.usageCost).toBeCloseTo(60, 5); // 2000 * 0.03
      expect(result.totalDue).toBeCloseTo(110, 5); // 50 fixed + 60 usage
    }
  });

  it('PER_PAGE bills the real count once it exceeds the minimum', async () => {
    prisma.contract.findFirst.mockResolvedValue({
      pricingModel: 'PER_PAGE',
      fixedFee: null,
      pricePerPageMono: '0.03',
      pricePerPageColor: '0.03',
      minimumPagesMono: 500,
      minimumPagesColor: 0,
    });
    prisma.device.findMany.mockResolvedValue([makeDevice()]);
    prisma.metric.findFirst.mockResolvedValue({ collectedAt: new Date('2026-08-31T00:00:00Z'), pageCount: BigInt(0), monoPageCount: null, colorPageCount: null });
    prisma.metric.findMany.mockResolvedValue([{ collectedAt: periodEnd, pageCount: BigInt(1339), monoPageCount: null, colorPageCount: null }]);

    const result = await service.resolveBilling('t1', 'c1', periodStart, periodEnd);

    expect(result.hasContract).toBe(true);
    if (result.hasContract) {
      expect(result.billablePages).toBe(1339); // above the 500 minimum, bills the real count
      expect(result.usageCost).toBeCloseTo(1339 * 0.03, 5);
    }
  });

  it('propagates a mid-period counter reset through to the billed total instead of undercounting to zero', async () => {
    prisma.contract.findFirst.mockResolvedValue({
      pricingModel: 'PER_PAGE',
      fixedFee: null,
      pricePerPageMono: '0.10',
      pricePerPageColor: '0.10',
      minimumPagesMono: 0,
      minimumPagesColor: 0,
    });
    prisma.device.findMany.mockResolvedValue([makeDevice()]);
    prisma.metric.findFirst.mockResolvedValue({ collectedAt: new Date('2026-08-31T00:00:00Z'), pageCount: BigInt(1000), monoPageCount: null, colorPageCount: null });
    // A genuine reset mid-period: 1000 -> 1500 -> 50 (reset) -> 300.
    prisma.metric.findMany.mockResolvedValue([
      { collectedAt: new Date('2026-09-10T00:00:00Z'), pageCount: BigInt(1500), monoPageCount: null, colorPageCount: null },
      { collectedAt: new Date('2026-09-20T00:00:00Z'), pageCount: BigInt(50), monoPageCount: null, colorPageCount: null },
      { collectedAt: periodEnd, pageCount: BigInt(300), monoPageCount: null, colorPageCount: null },
    ]);

    const result = await service.resolveBilling('t1', 'c1', periodStart, periodEnd);

    expect(result.hasContract).toBe(true);
    if (result.hasContract) {
      expect(result.totalPages).toBe(800); // 500 + 50 (reset) + 250, not 0 or a negative delta
      expect(result.perDevice[0].counterReset).toBe(true);
    }
  });
  it('a manual baseline fills the gap when monitoring started after the period began', async () => {
    prisma.contract.findFirst.mockResolvedValue({
      pricingModel: 'PER_PAGE',
      fixedFee: null,
      pricePerPageMono: '0.10',
      pricePerPageColor: '0.10',
      minimumPagesMono: 0,
      minimumPagesColor: 0,
    });
    // No metric at all before periodStart (Sept 1) - monitoring only
    // started mid-month, same real situation this test guards against.
    prisma.metric.findFirst.mockResolvedValue(null);
    prisma.metric.findMany.mockResolvedValue([
      { collectedAt: new Date('2026-09-08T00:00:00Z'), pageCount: BigInt(200500), monoPageCount: null, colorPageCount: null },
      { collectedAt: periodEnd, pageCount: BigInt(205000), monoPageCount: null, colorPageCount: null },
    ]);

    // Known reading from a manual check on Sept 7, the day before the agent
    // started polling - earlier than the first real metric (Sept 8).
    prisma.device.findMany.mockResolvedValue([
      makeDevice({
        manualBaselineDate: new Date('2026-09-07T00:00:00Z'),
        manualBaselinePageCount: BigInt(200000),
      }),
    ]);
    const withBaseline = await service.resolveBilling('t1', 'c1', periodStart, periodEnd);
    expect(withBaseline.hasContract).toBe(true);
    if (withBaseline.hasContract) {
      expect(withBaseline.totalPages).toBe(5000); // 200000 -> 205000, includes the Sept 7-8 gap
      expect(withBaseline.perDevice[0].usedManualBaseline).toBe(true);
      expect(withBaseline.perDevice[0].startReading).toBe(200000);
      expect(withBaseline.usageCost).toBeCloseTo(500, 5);
    }

    // Same device, no manual baseline - the same real metrics alone
    // undercount by exactly the manual entry's contribution (500 pages),
    // confirming the flag isn't a no-op.
    prisma.device.findMany.mockResolvedValue([makeDevice()]);
    const withoutBaseline = await service.resolveBilling('t1', 'c1', periodStart, periodEnd);
    expect(withoutBaseline.hasContract).toBe(true);
    if (withoutBaseline.hasContract) {
      expect(withoutBaseline.totalPages).toBe(4500); // 200500 -> 205000 only
      expect(withoutBaseline.perDevice[0].usedManualBaseline).toBe(false);
    }
  });

  it('ignores a manual baseline dated after the first real reading, or after the period ends', async () => {
    prisma.contract.findFirst.mockResolvedValue({
      pricingModel: 'PER_PAGE',
      fixedFee: null,
      pricePerPageMono: '0.10',
      pricePerPageColor: '0.10',
      minimumPagesMono: 0,
      minimumPagesColor: 0,
    });
    prisma.metric.findFirst.mockResolvedValue({
      collectedAt: new Date('2026-08-31T00:00:00Z'),
      pageCount: BigInt(1000),
      monoPageCount: null,
      colorPageCount: null,
    });
    prisma.metric.findMany.mockResolvedValue([
      { collectedAt: periodEnd, pageCount: BigInt(1500), monoPageCount: null, colorPageCount: null },
    ]);

    // A real reading already exists before periodStart, so a manual entry
    // dated after it (even if still inside the period) shouldn't override
    // it or get spliced into the sequence.
    prisma.device.findMany.mockResolvedValue([
      makeDevice({
        manualBaselineDate: new Date('2026-09-15T00:00:00Z'),
        manualBaselinePageCount: BigInt(999999),
      }),
    ]);
    const result = await service.resolveBilling('t1', 'c1', periodStart, periodEnd);

    expect(result.hasContract).toBe(true);
    if (result.hasContract) {
      expect(result.totalPages).toBe(500); // 1000 -> 1500, real data only
      expect(result.perDevice[0].usedManualBaseline).toBe(false);
    }
  });
});

describe('ContractsService.currentPeriodPreview', () => {
  let service: ContractsService;
  let prisma: { customer: { findFirst: jest.Mock }; contract: { findFirst: jest.Mock; findMany: jest.Mock } };

  beforeEach(async () => {
    prisma = {
      customer: { findFirst: jest.fn() },
      contract: { findFirst: jest.fn(), findMany: jest.fn() },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [ContractsService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = moduleRef.get(ContractsService);
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-09-15T12:00:00Z'));
  });

  afterEach(() => jest.useRealTimers());

  it('calls resolveBilling with the current month-to-date window, not the full month', async () => {
    prisma.customer.findFirst.mockResolvedValue({ id: 'c1' });
    const spy = jest.spyOn(service, 'resolveBilling').mockResolvedValue({ hasContract: false, periodStart: new Date(), periodEnd: new Date() });

    await service.currentPeriodPreview('t1', 'c1');

    expect(spy).toHaveBeenCalledWith('t1', 'c1', new Date('2026-09-01T00:00:00.000Z'), new Date('2026-09-15T12:00:00Z'));
  });

  it('throws when the customer does not belong to this tenant', async () => {
    prisma.customer.findFirst.mockResolvedValue(null);
    await expect(service.currentPeriodPreview('t1', 'missing')).rejects.toThrow();
  });
});

describe('ContractsService.portfolioCurrentPeriodPreview', () => {
  let service: ContractsService;
  let prisma: { customer: { findFirst: jest.Mock }; contract: { findFirst: jest.Mock; findMany: jest.Mock } };

  beforeEach(async () => {
    prisma = {
      customer: { findFirst: jest.fn() },
      contract: { findFirst: jest.fn(), findMany: jest.fn() },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [ContractsService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = moduleRef.get(ContractsService);
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-09-15T12:00:00Z'));
  });

  afterEach(() => jest.useRealTimers());

  it('sums totalDue across every customer with an active contract, sorted highest first', async () => {
    prisma.contract.findMany.mockResolvedValue([
      { customerId: 'a', customer: { id: 'a', name: 'Customer A' } },
      { customerId: 'b', customer: { id: 'b', name: 'Customer B' } },
    ]);

    jest
      .spyOn(service, 'resolveBilling')
      .mockImplementation(async (_tenantId, customerId) =>
        customerId === 'a'
          ? ({ hasContract: true, totalDue: 100, totalPages: 500 } as never)
          : ({ hasContract: true, totalDue: 250, totalPages: 900 } as never),
      );

    const result = await service.portfolioCurrentPeriodPreview('t1');

    expect(result.totalAccrued).toBe(350);
    expect(result.byCustomer).toEqual([
      { customerId: 'b', customerName: 'Customer B', totalDue: 250, totalPages: 900 },
      { customerId: 'a', customerName: 'Customer A', totalDue: 100, totalPages: 500 },
    ]);
  });

  it('a customer whose contract stopped covering today contributes zero, not an error', async () => {
    prisma.contract.findMany.mockResolvedValue([{ customerId: 'a', customer: { id: 'a', name: 'Customer A' } }]);
    jest.spyOn(service, 'resolveBilling').mockResolvedValue({ hasContract: false, periodStart: new Date(), periodEnd: new Date() });

    const result = await service.portfolioCurrentPeriodPreview('t1');

    expect(result.totalAccrued).toBe(0);
    expect(result.byCustomer[0].totalDue).toBe(0);
  });

  it('returns zero totals when there are no active contracts at all', async () => {
    prisma.contract.findMany.mockResolvedValue([]);
    const result = await service.portfolioCurrentPeriodPreview('t1');
    expect(result.totalAccrued).toBe(0);
    expect(result.byCustomer).toEqual([]);
  });
});
