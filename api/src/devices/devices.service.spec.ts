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
});
