import { Test } from '@nestjs/testing';
import { NotificationsService } from './notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { InvoicesService } from '../invoices/invoices.service';
import { DevicesService } from '../devices/devices.service';
import { EmailService } from '../email/email.service';

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
    user: { findMany: jest.Mock };
    tenant: { findUniqueOrThrow: jest.Mock; update: jest.Mock };
  };
  let invoicesService: { alerts: jest.Mock };
  let devicesService: { activeAlerts: jest.Mock; lowSupplyForecast: jest.Mock; listUnassigned: jest.Mock };
  let emailService: { send: jest.Mock };

  // Default: email preferences on, listening to every type used in these
  // tests - individual tests override this to check the gating itself.
  function mockPrefs(emailEnabled: boolean, emailTypes: string[]) {
    prisma.tenant.findUniqueOrThrow.mockResolvedValue({ notifyEmailEnabled: emailEnabled, notifyEmailTypes: emailTypes });
  }

  beforeEach(async () => {
    prisma = {
      notification: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      user: { findMany: jest.fn().mockResolvedValue([]) },
      tenant: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ notifyEmailEnabled: true, notifyEmailTypes: ['UNASSIGNED_DEVICE'] }),
        update: jest.fn(),
      },
    };
    invoicesService = { alerts: jest.fn().mockResolvedValue({ overdueInvoices: [], expiringContracts: [] }) };
    devicesService = {
      activeAlerts: jest.fn().mockResolvedValue([]),
      lowSupplyForecast: jest.fn().mockResolvedValue([]),
      listUnassigned: jest.fn().mockResolvedValue([]),
    };
    emailService = { send: jest.fn().mockResolvedValue(undefined) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: PrismaService, useValue: prisma },
        { provide: InvoicesService, useValue: invoicesService },
        { provide: DevicesService, useValue: devicesService },
        { provide: EmailService, useValue: emailService },
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
        linkHref: '/devices/dev-1',
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

  describe('digest email', () => {
    it('emails every non-revoked user with the notifications permission when something new is created (sendEmail: true)', async () => {
      devicesService.listUnassigned.mockResolvedValue([
        { id: 'dev-1', name: 'HP LaserJet', printerName: null, customLabel: null, host: '10.0.0.5', serialNumber: null },
      ]);
      prisma.user.findMany.mockResolvedValue([{ email: 'admin@empresa.com' }, { email: 'financeiro@empresa.com' }]);

      await service.syncNotifications('tenant-1', { sendEmail: true });

      expect(prisma.user.findMany).toHaveBeenCalledWith({
        where: { tenantId: 'tenant-1', revokedAt: null, permissions: { has: 'notifications' } },
        select: { email: true },
      });
      expect(emailService.send).toHaveBeenCalledTimes(1);
      const call = emailService.send.mock.calls[0][0];
      expect(call.to).toEqual(['admin@empresa.com', 'financeiro@empresa.com']);
      expect(call.subject).toContain('1 novo aviso');
      expect(call.html).toContain('Dispositivo sem cliente: HP LaserJet');
    });

    it('never emails on the default/manual path, even with something new and preferences fully on', async () => {
      devicesService.listUnassigned.mockResolvedValue([
        { id: 'dev-1', name: 'HP LaserJet', printerName: null, customLabel: null, host: '10.0.0.5', serialNumber: null },
      ]);
      prisma.user.findMany.mockResolvedValue([{ email: 'admin@empresa.com' }]);

      const result = await service.syncNotifications('tenant-1'); // no opts - the manual-sync-endpoint shape

      expect(result.created).toBe(1);
      expect(prisma.tenant.findUniqueOrThrow).not.toHaveBeenCalled();
      expect(emailService.send).not.toHaveBeenCalled();
    });

    it('does not email when nothing new was created (only updates or auto-resolves)', async () => {
      prisma.notification.findMany.mockResolvedValue([{ dedupeKey: 'unassigned-device:dev-1', resolvedAt: null }]);
      devicesService.listUnassigned.mockResolvedValue([
        { id: 'dev-1', name: 'HP LaserJet', printerName: null, customLabel: null, host: '10.0.0.5', serialNumber: null },
      ]);

      const result = await service.syncNotifications('tenant-1', { sendEmail: true });

      expect(result.created).toBe(0);
      expect(result.updated).toBe(1);
      expect(emailService.send).not.toHaveBeenCalled();
    });

    it('skips the recipient lookup entirely when nothing new was detected at all', async () => {
      await service.syncNotifications('tenant-1', { sendEmail: true });

      expect(prisma.user.findMany).not.toHaveBeenCalled();
      expect(emailService.send).not.toHaveBeenCalled();
    });

    it('respects the tenant-level master switch - disabled means no email even with something new and sendEmail: true', async () => {
      mockPrefs(false, ['UNASSIGNED_DEVICE']);
      devicesService.listUnassigned.mockResolvedValue([
        { id: 'dev-1', name: 'HP LaserJet', printerName: null, customLabel: null, host: '10.0.0.5', serialNumber: null },
      ]);

      await service.syncNotifications('tenant-1', { sendEmail: true });

      expect(prisma.user.findMany).not.toHaveBeenCalled();
      expect(emailService.send).not.toHaveBeenCalled();
    });

    it('filters the digest down to only the categories the tenant selected', async () => {
      mockPrefs(true, ['CRITICAL_DEVICE_ALERT']); // UNASSIGNED_DEVICE not selected
      devicesService.listUnassigned.mockResolvedValue([
        { id: 'dev-1', name: 'HP LaserJet', printerName: null, customLabel: null, host: '10.0.0.5', serialNumber: null },
      ]);
      prisma.user.findMany.mockResolvedValue([{ email: 'admin@empresa.com' }]);

      await service.syncNotifications('tenant-1', { sendEmail: true });

      // Real thing detected (created: 1 either way), but nothing in the
      // selected categories - so the recipient lookup never even runs.
      expect(prisma.user.findMany).not.toHaveBeenCalled();
      expect(emailService.send).not.toHaveBeenCalled();
    });

    it('sends only the selected-category items when a sync mixes categories', async () => {
      mockPrefs(true, ['UNASSIGNED_DEVICE']); // CRITICAL_DEVICE_ALERT excluded
      devicesService.listUnassigned.mockResolvedValue([
        { id: 'dev-1', name: 'HP LaserJet', printerName: null, customLabel: null, host: '10.0.0.5', serialNumber: null },
      ]);
      devicesService.activeAlerts.mockResolvedValue([
        { deviceId: 'dev-2', deviceName: 'Xerox', severity: 'critical', code: 42 },
      ]);
      prisma.user.findMany.mockResolvedValue([{ email: 'admin@empresa.com' }]);

      await service.syncNotifications('tenant-1', { sendEmail: true });

      expect(emailService.send).toHaveBeenCalledTimes(1);
      const call = emailService.send.mock.calls[0][0];
      expect(call.subject).toContain('1 novo aviso');
      expect(call.html).toContain('Dispositivo sem cliente: HP LaserJet');
      expect(call.html).not.toContain('Xerox');
    });
  });

  describe('email preferences', () => {
    it('reads the tenant-level preference columns', async () => {
      mockPrefs(true, ['LOW_SUPPLY', 'CRITICAL_DEVICE_ALERT']);

      const prefs = await service.getEmailPreferences('tenant-1');

      expect(prisma.tenant.findUniqueOrThrow).toHaveBeenCalledWith({
        where: { id: 'tenant-1' },
        select: { notifyEmailEnabled: true, notifyEmailTypes: true },
      });
      expect(prefs).toEqual({ emailEnabled: true, emailTypes: ['LOW_SUPPLY', 'CRITICAL_DEVICE_ALERT'] });
    });

    it('writes both preference columns together', async () => {
      prisma.tenant.update.mockResolvedValue({ notifyEmailEnabled: true, notifyEmailTypes: ['OVERDUE_INVOICE'] });

      const prefs = await service.updateEmailPreferences('tenant-1', { emailEnabled: true, emailTypes: ['OVERDUE_INVOICE'] });

      expect(prisma.tenant.update).toHaveBeenCalledWith({
        where: { id: 'tenant-1' },
        data: { notifyEmailEnabled: true, notifyEmailTypes: ['OVERDUE_INVOICE'] },
        select: { notifyEmailEnabled: true, notifyEmailTypes: true },
      });
      expect(prefs).toEqual({ emailEnabled: true, emailTypes: ['OVERDUE_INVOICE'] });
    });
  });
});
