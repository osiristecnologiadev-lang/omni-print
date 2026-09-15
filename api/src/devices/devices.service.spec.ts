import { Test } from '@nestjs/testing';
import { DevicesService } from './devices.service';
import { PrismaService } from '../prisma/prisma.service';
import { DevicePagesService } from '../common/device-pages.service';

// currentMonthPages/fleetCurrentMonthPages just resolve the device(s) and
// the current UTC month's boundary, then delegate the actual reset/fallback
// math to DevicePagesService (already covered exhaustively via
// ContractsService.resolveBilling's tests, since both share it) - these
// tests cover this method's own job: scoping and period-boundary math, not
// re-proving the delta logic. DevicePagesService is mocked here on purpose.
describe('DevicesService.currentMonthPages', () => {
  let service: DevicesService;
  let prisma: { device: { findFirst: jest.Mock; findMany: jest.Mock } };
  let devicePages: { pagesInPeriod: jest.Mock };

  beforeEach(async () => {
    prisma = { device: { findFirst: jest.fn(), findMany: jest.fn() } };
    devicePages = { pagesInPeriod: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        DevicesService,
        { provide: PrismaService, useValue: prisma },
        { provide: DevicePagesService, useValue: devicePages },
      ],
    }).compile();

    service = moduleRef.get(DevicesService);
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-09-15T12:00:00Z'));
  });

  afterEach(() => jest.useRealTimers());

  it('throws when the device does not belong to this tenant/customer', async () => {
    prisma.device.findFirst.mockResolvedValue(null);
    await expect(service.currentMonthPages('t1', null, 'missing-device')).rejects.toThrow();
  });

  it('uses the 1st of the current UTC month through right now as the window', async () => {
    prisma.device.findFirst.mockResolvedValue({ id: 'd1' });
    devicePages.pagesInPeriod.mockResolvedValue({ pages: 42, enginePages: 42 });

    const result = await service.currentMonthPages('t1', null, 'd1');

    expect(devicePages.pagesInPeriod).toHaveBeenCalledWith(
      { id: 'd1' },
      new Date('2026-09-01T00:00:00.000Z'),
      new Date('2026-09-15T12:00:00.000Z'),
    );
    expect(result.pages).toBe(42);
    expect(result.periodStart).toBe('2026-09-01T00:00:00.000Z');
  });
});

describe('DevicesService.fleetCurrentMonthPages', () => {
  let service: DevicesService;
  let prisma: { device: { findFirst: jest.Mock; findMany: jest.Mock } };
  let devicePages: { pagesInPeriod: jest.Mock };

  beforeEach(async () => {
    prisma = { device: { findFirst: jest.fn(), findMany: jest.fn() } };
    devicePages = { pagesInPeriod: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        DevicesService,
        { provide: PrismaService, useValue: prisma },
        { provide: DevicePagesService, useValue: devicePages },
      ],
    }).compile();

    service = moduleRef.get(DevicesService);
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-09-15T12:00:00Z'));
  });

  afterEach(() => jest.useRealTimers());

  it('sums pages across every device, independent of whether any has a billing contract', async () => {
    prisma.device.findMany.mockResolvedValue([{ id: 'd1' }, { id: 'd2' }, { id: 'd3' }]);
    devicePages.pagesInPeriod
      .mockResolvedValueOnce({ pages: 100 })
      .mockResolvedValueOnce({ pages: 250 })
      .mockResolvedValueOnce({ pages: 0 });

    const result = await service.fleetCurrentMonthPages('t1', null);

    expect(result.totalPages).toBe(350);
    expect(result.deviceCount).toBe(3);
  });

  it('returns zero for a fleet with no devices, not an error', async () => {
    prisma.device.findMany.mockResolvedValue([]);
    const result = await service.fleetCurrentMonthPages('t1', null);
    expect(result.totalPages).toBe(0);
    expect(result.deviceCount).toBe(0);
  });

  // Feeds the dashboard's "Top impressoras" panel - the per-device figures
  // were already computed to build totalPages above, this just exposes the
  // top ones instead of discarding them after the sum.
  it('returns the top devices by volume, sorted descending', async () => {
    prisma.device.findMany.mockResolvedValue([
      { id: 'd1', printerName: 'HP LaserJet', name: null, customLabel: null, host: '10.0.0.1', customer: { name: 'Acme' } },
      { id: 'd2', printerName: 'Brother', name: null, customLabel: 'Recepção', host: '10.0.0.2', customer: { name: 'Beta' } },
      { id: 'd3', printerName: 'Epson', name: null, customLabel: null, host: '10.0.0.3', customer: null },
    ]);
    devicePages.pagesInPeriod
      .mockResolvedValueOnce({ pages: 100 })
      .mockResolvedValueOnce({ pages: 900 })
      .mockResolvedValueOnce({ pages: 50 });

    const result = await service.fleetCurrentMonthPages('t1', null);

    expect(result.topDevices.map((d: { deviceId: string; pages: number }) => [d.deviceId, d.pages])).toEqual([
      ['d2', 900],
      ['d1', 100],
      ['d3', 50],
    ]);
    expect(result.topDevices[0]).toEqual(
      expect.objectContaining({ customLabel: 'Recepção', customerName: 'Beta', printerName: 'Brother' }),
    );
    expect(result.topDevices[2].customerName).toBeNull();
  });

  it('caps topDevices at topN and excludes devices with zero pages this month', async () => {
    prisma.device.findMany.mockResolvedValue([
      { id: 'd1', printerName: 'A', name: null, customLabel: null, host: 'h1', customer: null },
      { id: 'd2', printerName: 'B', name: null, customLabel: null, host: 'h2', customer: null },
      { id: 'd3', printerName: 'C', name: null, customLabel: null, host: 'h3', customer: null },
      { id: 'd4', printerName: 'D (parada)', name: null, customLabel: null, host: 'h4', customer: null },
    ]);
    devicePages.pagesInPeriod
      .mockResolvedValueOnce({ pages: 10 })
      .mockResolvedValueOnce({ pages: 20 })
      .mockResolvedValueOnce({ pages: 30 })
      .mockResolvedValueOnce({ pages: 0 });

    const result = await service.fleetCurrentMonthPages('t1', null, 2);

    expect(result.topDevices).toHaveLength(2);
    expect(result.topDevices.map((d: { deviceId: string }) => d.deviceId)).toEqual(['d3', 'd2']);
  });
});

// pageTrend used to bucket purely off the engine/mechanism counter
// (pageCount), unlike every other page-count figure in the app which
// prefers the vendor's real "pages printed" counter once a device reports
// one (see DevicePagesService.pagesInPeriod) - flagged as a known gap in
// project_omniprint_printed_pages_billing_20260909. These tests lock in the
// fix: same preference, decided once for the whole queried range so a
// device transitioning from engine-only to split reporting doesn't register
// a fake reset/drop on the day the split counter starts (a printed-pages
// total reads far lower than the engine total it replaces).
describe('DevicesService.pageTrend', () => {
  let service: DevicesService;
  let prisma: {
    device: { findFirst: jest.Mock };
    metric: { findFirst: jest.Mock; findMany: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      device: { findFirst: jest.fn() },
      metric: { findFirst: jest.fn(), findMany: jest.fn() },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        DevicesService,
        { provide: PrismaService, useValue: prisma },
        { provide: DevicePagesService, useValue: { pagesInPeriod: jest.fn() } },
      ],
    }).compile();

    service = moduleRef.get(DevicesService);
    prisma.device.findFirst.mockResolvedValue({ id: 'd1' });
  });

  it('buckets off the engine counter when the device never reports a split', async () => {
    prisma.metric.findFirst.mockResolvedValue({
      collectedAt: new Date('2026-09-01T00:00:00Z'),
      pageCount: BigInt(1000),
      monoPageCount: null,
      colorPageCount: null,
    });
    prisma.metric.findMany.mockResolvedValue([
      { collectedAt: new Date('2026-09-02T00:00:00Z'), pageCount: BigInt(1050), monoPageCount: null, colorPageCount: null },
      { collectedAt: new Date('2026-09-03T00:00:00Z'), pageCount: BigInt(1120), monoPageCount: null, colorPageCount: null },
    ]);

    const result = await service.pageTrend('t1', null, 'd1', 30);

    expect(result).toEqual([
      { date: '2026-09-02', pages: 50 },
      { date: '2026-09-03', pages: 70 },
    ]);
  });

  it('prefers the printed-pages split total once at least 2 split readings exist in range', async () => {
    // Engine counter here is deliberately much larger than the split total
    // (mirrors the real device from the 2026-09-09 investigation: ~75k
    // engine vs ~6k printed) - if the fix regressed to engine-first this
    // would produce wildly different numbers than asserted below.
    prisma.metric.findFirst.mockResolvedValue({
      collectedAt: new Date('2026-09-01T00:00:00Z'),
      pageCount: BigInt(75000),
      monoPageCount: BigInt(6000),
      colorPageCount: BigInt(0),
    });
    prisma.metric.findMany.mockResolvedValue([
      { collectedAt: new Date('2026-09-02T00:00:00Z'), pageCount: BigInt(75100), monoPageCount: BigInt(6040), colorPageCount: BigInt(10) },
      { collectedAt: new Date('2026-09-03T00:00:00Z'), pageCount: BigInt(75300), monoPageCount: BigInt(6100), colorPageCount: BigInt(15) },
    ]);

    const result = await service.pageTrend('t1', null, 'd1', 30);

    expect(result).toEqual([
      { date: '2026-09-02', pages: 50 }, // (6040+10) - (6000+0)
      { date: '2026-09-03', pages: 65 }, // (6100+15) - (6040+10)
    ]);
  });

  it('does not register a fake drop the day a device starts reporting a real split', async () => {
    // Baseline and day 1 are engine-only (no split data yet, small numbers
    // for readability); day 2 and day 3 start reporting a split whose
    // combined total is nowhere near the engine total - once 2 split
    // readings exist, the split pipeline takes over for the WHOLE range, so
    // the day-2 delta must be computed only between the two split readings,
    // never as (day2 split value) - (day1 engine value).
    prisma.metric.findFirst.mockResolvedValue({
      collectedAt: new Date('2026-09-01T00:00:00Z'),
      pageCount: BigInt(1000),
      monoPageCount: null,
      colorPageCount: null,
    });
    prisma.metric.findMany.mockResolvedValue([
      { collectedAt: new Date('2026-09-02T00:00:00Z'), pageCount: BigInt(1050), monoPageCount: null, colorPageCount: null },
      { collectedAt: new Date('2026-09-03T00:00:00Z'), pageCount: BigInt(1900), monoPageCount: BigInt(50), colorPageCount: BigInt(0) },
      { collectedAt: new Date('2026-09-04T00:00:00Z'), pageCount: BigInt(2000), monoPageCount: BigInt(80), colorPageCount: BigInt(5) },
    ]);

    const result = await service.pageTrend('t1', null, 'd1', 30);

    // Only the two split-bearing days appear (the engine-only baseline/day-1
    // readings drop out of the split series entirely, same as
    // DevicePagesService.pagesInPeriod's realSplitReadings filter) - and the
    // delta is a sane 35, not a fake ~850 that mixing series would produce.
    expect(result).toEqual([{ date: '2026-09-04', pages: 35 }]);
  });

  it('throws when the device does not belong to this tenant/customer', async () => {
    prisma.device.findFirst.mockResolvedValue(null);
    await expect(service.pageTrend('t1', null, 'missing-device', 30)).rejects.toThrow();
  });
});
