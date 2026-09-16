import { ForbiddenException } from '@nestjs/common';
import { UsersController } from './users.controller';
import type { UsersService } from './users.service';
import type { AuditLogService } from '../audit-log/audit-log.service';

// Constructed directly, not via Nest's TestingModule - same reasoning as
// customers.controller.spec.ts.
describe('UsersController', () => {
  let controller: UsersController;
  let usersService: { list: jest.Mock; create: jest.Mock; revoke: jest.Mock; updatePermissions: jest.Mock };
  let auditLog: { log: jest.Mock };

  beforeEach(() => {
    usersService = { list: jest.fn(), create: jest.fn(), revoke: jest.fn(), updatePermissions: jest.fn() };
    auditLog = { log: jest.fn() };
    controller = new UsersController(usersService as unknown as UsersService, auditLog as unknown as AuditLogService);
  });

  describe('me', () => {
    it('returns customerId/permissions straight off the request, for either session type', () => {
      expect(controller.me({ customerId: null, permissions: ['contracts', 'devices'] })).toEqual({
        customerId: null,
        permissions: ['contracts', 'devices'],
      });
      expect(controller.me({ customerId: 'c1', permissions: ['invoices_view'] })).toEqual({
        customerId: 'c1',
        permissions: ['invoices_view'],
      });
    });
  });

  describe('list/create/revoke', () => {
    const tenantWideReq = { tenantId: 't1', customerId: null, userId: 'u1', userEmail: 'admin@example.com', permissions: ['users'] };

    it('rejects a session missing the users permission', () => {
      expect(() => controller.list({ tenantId: 't1', customerId: null, permissions: [] })).toThrow(
        ForbiddenException,
      );
      expect(usersService.list).not.toHaveBeenCalled();
    });

    it('allows a session with the users permission', () => {
      controller.list(tenantWideReq);
      expect(usersService.list).toHaveBeenCalledWith('t1');
    });

    it('create logs user.create with the actor and the new user\'s scope/permissions', async () => {
      usersService.create.mockResolvedValue({ id: 'new-1', email: 'novo@example.com', customerId: null, permissions: ['devices'] });

      await controller.create(tenantWideReq, { email: 'novo@example.com', password: 'password1', permissions: ['devices'] });

      expect(usersService.create).toHaveBeenCalledWith('t1', ['users'], {
        email: 'novo@example.com',
        password: 'password1',
        permissions: ['devices'],
      });
      expect(auditLog.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'user.create',
          targetId: 'new-1',
          metadata: { customerId: null, permissions: ['devices'] },
        }),
      );
    });
  });

  describe('updatePermissions', () => {
    const tenantWideReq = { tenantId: 't1', customerId: null, userId: 'u1', userEmail: 'admin@example.com', permissions: ['users'] };

    it('rejects a session missing the users permission', async () => {
      await expect(
        controller.updatePermissions({ tenantId: 't1', customerId: null, permissions: [] }, 'target-1', {
          permissions: ['devices'],
        }),
      ).rejects.toThrow(ForbiddenException);
      expect(usersService.updatePermissions).not.toHaveBeenCalled();
    });

    it('updates and logs user.update_permissions with the resulting set', async () => {
      usersService.updatePermissions.mockResolvedValue({
        id: 'target-1',
        email: 'tecnico@example.com',
        permissions: ['devices', 'tickets'],
      });

      await controller.updatePermissions(tenantWideReq, 'target-1', { permissions: ['devices', 'tickets'] });

      expect(usersService.updatePermissions).toHaveBeenCalledWith('t1', ['users'], 'target-1', ['devices', 'tickets']);
      expect(auditLog.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'user.update_permissions',
          targetId: 'target-1',
          metadata: { permissions: ['devices', 'tickets'] },
        }),
      );
    });
  });
});
