import { DevicesController } from './devices.controller';
import type { DevicesService } from './devices.service';
import type { AuditLogService } from '../audit-log/audit-log.service';

// The other headline example ("quem reatribuiu um dispositivo"). PATCH
// /devices/:id bundles 3 independent admin actions (customer reassignment,
// custom label, manual baseline) behind one DTO - these tests confirm each
// produces its own distinct, correctly-labeled audit entry, and only when
// that specific field was actually present in the request.
//
// Constructed directly, not via Nest's TestingModule - see
// customers.controller.spec.ts's comment for why.
describe('DevicesController audit logging', () => {
  let controller: DevicesController;
  let devicesService: { update: jest.Mock; assertTenantWide: jest.Mock };
  let auditLog: { log: jest.Mock };

  const req = { tenantId: 't1', customerId: null, userId: 'u1', userEmail: 'admin@example.com' };
  const device = { id: 'd1', customLabel: 'Recepção', printerName: 'HP LaserJet', name: null, host: '10.0.0.5' };

  beforeEach(() => {
    devicesService = { update: jest.fn().mockResolvedValue(device), assertTenantWide: jest.fn() };
    auditLog = { log: jest.fn() };
    controller = new DevicesController(
      devicesService as unknown as DevicesService,
      auditLog as unknown as AuditLogService,
    );
  });

  it('logs device.reassign_customer when customerId is sent', async () => {
    await controller.update(req, 'd1', { customerId: 'c2' });

    expect(auditLog.log).toHaveBeenCalledTimes(1);
    expect(auditLog.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'device.reassign_customer',
        targetId: 'd1',
        targetLabel: 'Recepção',
        actorId: 'u1',
        actorLabel: 'admin@example.com',
        metadata: { customerId: 'c2' },
      }),
    );
  });

  it('logs device.set_label instead when only customLabel is sent - not a reassignment', async () => {
    await controller.update(req, 'd1', { customLabel: 'Sala 2' });

    expect(auditLog.log).toHaveBeenCalledTimes(1);
    expect(auditLog.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'device.set_label' }));
  });

  it('logs both entries when a single PATCH changes both customer and label', async () => {
    await controller.update(req, 'd1', { customerId: 'c2', customLabel: 'Sala 2' });

    expect(auditLog.log).toHaveBeenCalledTimes(2);
    const actions = auditLog.log.mock.calls.map((call) => call[0].action);
    expect(actions).toEqual(expect.arrayContaining(['device.reassign_customer', 'device.set_label']));
  });

  it('logs nothing extra when the DTO is empty (no fields actually changed)', async () => {
    await controller.update(req, 'd1', {});

    expect(auditLog.log).not.toHaveBeenCalled();
  });
});
