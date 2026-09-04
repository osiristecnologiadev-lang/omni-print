import { Test } from '@nestjs/testing';
import { NotificationsService } from './notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { InvoicesService } from '../invoices/invoices.service';
import { DevicesService } from '../devices/devices.service';

// Focused on the UNASSIGNED_DEVICE source (see the shared-network scenario
// discussed with the user - two of the tenant's own customers on one
// physical network, so discovery can't reliably tell which printer belongs
// to which). The other three sources (overdue invoices, expiring
// contracts, critical alerts, low supply) already existed before this and
// aren't retested here.
describe('NotificationsService.syncNotifications', () => {
  let service: NotificationsService;
  let prisma: {
    notification: {
      findMany: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
    };
  };
  let invoicesService: { alerts: jest.Mock };
  let devicesService: { activeAlerts: jest.Mock; lowSupplyForecast: jest.Mock; listUnassigned: jest.Mock };

  beforeEach(async () => {
    prisma = {
      notification: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
    invoicesService = { alerts: jest.fn().mockResolvedValue({ overdueInvoices: [], expiringContracts: [] }) };
    devicesService = {
      activeAlerts: jest.fn().mockResolvedValue([]),
      lowSupplyForecast: jest.fn().mockResolvedValue([]),
      listUnassigned: jest.fn().mockResolvedValue([]),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: PrismaService, useValue: prisma },
        { provide: InvoicesService, useValue: invoicesService },
        { provide: DevicesService, useValue: devicesService },
      ],
    }).compile();

    service = moduleRef.get(NotificationsService);
  });

  it('creates one notification per unassigned device, keyed and worded for the customer picker', async () => {
    devicesService.listUnassigned.mockResolvedValue([
      { id: 'dev-1', name: 'HP LaserJet', printerName: null, customLabel: null, host: '10.0.0.5', serialNumber: 'SN123' },
      { id: 'dev-2', name: null, printerName: null, customLabel: 'Recepção', host: '10.0.0.6', serialNumber: null },
    ]);

    const result = await service.syncNotifications('tenant-1');

    expect(result.created).toBe(2);
    expect(prisma.notification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: 'UNASSIGNED_DEVICE',
        dedupeKey: 'unassigned-device:dev-1',
        title: 'Dispositivo sem cliente: HP LaserJet',
        body: expect.stringContaining('SN123'),
      }),
    });
    expect(prisma.notification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: 'UNASSIGNED_DEVICE',
        dedupeKey: 'unassigned-device:dev-2',
        // customLabel wins over the other name fields, same display
        // priority used everywhere else in the app (dashboard, device page).
        title: 'Dispositivo sem cliente: Recepção',
      }),
    });
  });

  it('auto-resolves once a device is assigned a customer (no longer in listUnassigned)', async () => {
    prisma.notification.findMany.mockResolvedValue([
      { dedupeKey: 'unassigned-device:dev-1', resolvedAt: null },
    ]);
    prisma.notification.updateMany.mockResolvedValue({ count: 1 });
    devicesService.listUnassigned.mockResolvedValue([]); // now assigned - no longer detected

    const result = await service.syncNotifications('tenant-1');

    expect(result.autoResolved).toBe(1);
    expect(prisma.notification.updateMany).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-1', dedupeKey: { in: ['unassigned-device:dev-1'] }, resolvedAt: null },
      data: { resolvedAt: expect.any(Date) },
    });
  });

  it('leaves an already-resolved unassigned-device notification alone even if still detected', async () => {
    prisma.notification.findMany.mockResolvedValue([
      { dedupeKey: 'unassigned-device:dev-1', resolvedAt: new Date('2026-01-01') },
    ]);
    devicesService.listUnassigned.mockResolvedValue([
      { id: 'dev-1', name: 'HP LaserJet', printerName: null, customLabel: null, host: '10.0.0.5', serialNumber: null },
    ]);

    const result = await service.syncNotifications('tenant-1');

    expect(result.created).toBe(0);
    expect(result.updated).toBe(0);
    expect(prisma.notification.create).not.toHaveBeenCalled();
    expect(prisma.notification.update).not.toHaveBeenCalled();
  });
});
