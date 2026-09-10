import { ForbiddenException } from '@nestjs/common';
import { AuditLogController, PlatformAuditLogController } from './audit-log.controller';
import type { AuditLogService } from './audit-log.service';

describe('AuditLogController', () => {
  let controller: AuditLogController;
  let auditLog: { listForTenant: jest.Mock };

  beforeEach(() => {
    auditLog = { listForTenant: jest.fn() };
    controller = new AuditLogController(auditLog as unknown as AuditLogService);
  });

  it('rejects a customer-scoped session', () => {
    expect(() => controller.list({ tenantId: 't1', customerId: 'c1' }, undefined, undefined)).toThrow(
      ForbiddenException,
    );
    expect(auditLog.listForTenant).not.toHaveBeenCalled();
  });

  it('scopes the query to the caller\'s own tenant and forwards limit/cursor', () => {
    controller.list({ tenantId: 't1', customerId: null }, '10', 'e5');
    expect(auditLog.listForTenant).toHaveBeenCalledWith('t1', { limit: 10, cursor: 'e5' });
  });

  it('defaults and caps limit', () => {
    controller.list({ tenantId: 't1', customerId: null }, undefined, undefined);
    expect(auditLog.listForTenant).toHaveBeenCalledWith('t1', { limit: 50, cursor: undefined });

    controller.list({ tenantId: 't1', customerId: null }, '9999', undefined);
    expect(auditLog.listForTenant).toHaveBeenLastCalledWith('t1', { limit: 100, cursor: undefined });
  });
});

describe('PlatformAuditLogController', () => {
  it('lists platform-admin-actor entries, not tenant-scoped ones', () => {
    const auditLog = { listForPlatformAdmins: jest.fn() };
    const controller = new PlatformAuditLogController(auditLog as unknown as AuditLogService);

    controller.list('25', undefined);

    expect(auditLog.listForPlatformAdmins).toHaveBeenCalledWith({ limit: 25, cursor: undefined });
  });
});
