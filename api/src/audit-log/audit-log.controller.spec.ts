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
    controller.list({ tenantId: 't1', customerId: null, permissions: ['audit_log'] }, '10', 'e5');
    expect(auditLog.listForTenant).toHaveBeenCalledWith('t1', { limit: 10, cursor: 'e5' });
  });

  it('defaults and caps limit', () => {
    controller.list({ tenantId: 't1', customerId: null, permissions: ['audit_log'] }, undefined, undefined);
    expect(auditLog.listForTenant).toHaveBeenCalledWith('t1', { limit: 50, cursor: undefined });

    controller.list({ tenantId: 't1', customerId: null, permissions: ['audit_log'] }, '9999', undefined);
    expect(auditLog.listForTenant).toHaveBeenLastCalledWith('t1', { limit: 100, cursor: undefined });
  });

  it('forwards action/targetType filters, dropping empty strings', () => {
    controller.list(
      { tenantId: 't1', customerId: null, permissions: ['audit_log'] },
      undefined,
      undefined,
      'customer.create',
      'Customer',
    );
    expect(auditLog.listForTenant).toHaveBeenCalledWith(
      't1',
      expect.objectContaining({ action: 'customer.create', targetType: 'Customer' }),
    );

    controller.list({ tenantId: 't1', customerId: null, permissions: ['audit_log'] }, undefined, undefined, '', '');
    expect(auditLog.listForTenant).toHaveBeenLastCalledWith(
      't1',
      expect.objectContaining({ action: undefined, targetType: undefined }),
    );
  });

  it('turns from/to date-input strings into a Date range, with `to` extended to end-of-day', () => {
    controller.list(
      { tenantId: 't1', customerId: null, permissions: ['audit_log'] },
      undefined,
      undefined,
      undefined,
      undefined,
      '2026-09-01',
      '2026-09-14',
    );
    const call = auditLog.listForTenant.mock.calls.at(-1)![1];
    expect(call.from.toISOString()).toBe('2026-09-01T00:00:00.000Z');
    expect(call.to.getHours()).toBe(23);
    expect(call.to.getMinutes()).toBe(59);
  });

  it('ignores an unparseable date string instead of sending an Invalid Date through', () => {
    controller.list(
      { tenantId: 't1', customerId: null, permissions: ['audit_log'] },
      undefined,
      undefined,
      undefined,
      undefined,
      'not-a-date',
    );
    const call = auditLog.listForTenant.mock.calls.at(-1)![1];
    expect(call.from).toBeUndefined();
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
