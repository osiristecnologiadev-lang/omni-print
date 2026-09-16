import { Test } from '@nestjs/testing';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { UsersService } from './users.service';
import { PrismaService } from '../prisma/prisma.service';
import { TENANT_ONLY_PERMISSION_KEYS } from '../auth/permissions.util';

const FULL_ACCESS = [...TENANT_ONLY_PERMISSION_KEYS];

describe('UsersService', () => {
  let service: UsersService;
  let prisma: {
    customer: { findFirst: jest.Mock };
    user: { findUnique: jest.Mock; findFirst: jest.Mock; create: jest.Mock; update: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      customer: { findFirst: jest.fn() },
      user: { findUnique: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
    };
    const moduleRef = await Test.createTestingModule({
      providers: [UsersService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(UsersService);
  });

  describe('create', () => {
    it('rejects a tenant-only permission for a customer-scoped user', async () => {
      prisma.customer.findFirst.mockResolvedValue({ id: 'c1', tenantId: 't1' });

      await expect(
        service.create('t1', FULL_ACCESS, {
          email: 'novo@example.com',
          password: 'password1',
          customerId: 'c1',
          permissions: ['contracts'],
        }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('rejects invoices_view for a tenant-wide user', async () => {
      await expect(
        service.create('t1', FULL_ACCESS, { email: 'novo@example.com', password: 'password1', permissions: ['invoices_view'] }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('defaults a tenant-wide user to full tenant-only access when permissions is omitted', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockImplementation(({ data }) => Promise.resolve({ id: 'u1', ...data }));

      const result = await service.create('t1', FULL_ACCESS, { email: 'novo@example.com', password: 'password1' });

      expect(result.permissions).toEqual(
        expect.arrayContaining(['contracts', 'invoices', 'customers', 'agent', 'users', 'devices', 'tickets']),
      );
      expect(result.permissions).not.toContain('invoices_view');
    });

    it('defaults a customer-scoped user to no permissions when omitted', async () => {
      prisma.customer.findFirst.mockResolvedValue({ id: 'c1', tenantId: 't1' });
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockImplementation(({ data }) => Promise.resolve({ id: 'u1', ...data }));

      const result = await service.create('t1', FULL_ACCESS, { email: 'cliente@example.com', password: 'password1', customerId: 'c1' });

      expect(result.permissions).toEqual([]);
    });

    it('still rejects a duplicate email', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'existing' });
      await expect(service.create('t1', FULL_ACCESS, { email: 'ja@existe.com', password: 'password1' })).rejects.toThrow(
        ConflictException,
      );
    });

    it('rejects creating a user with a tenant-only permission the actor does not hold themselves', async () => {
      await expect(
        service.create('t1', ['users'], { email: 'novo@example.com', password: 'password1', permissions: ['users', 'billing'] }),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('allows creating a customer-scoped user with invoices_view even though the (necessarily tenant-wide) actor never holds that key', async () => {
      prisma.customer.findFirst.mockResolvedValue({ id: 'c1', tenantId: 't1' });
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockImplementation(({ data }) => Promise.resolve({ id: 'u1', ...data }));

      const result = await service.create('t1', ['users'], {
        email: 'cliente@example.com',
        password: 'password1',
        customerId: 'c1',
        permissions: ['invoices_view'],
      });

      expect(result.permissions).toEqual(['invoices_view']);
    });
  });

  describe('updatePermissions', () => {
    it('throws NotFoundException for a user outside this tenant', async () => {
      prisma.user.findFirst.mockResolvedValue(null);
      await expect(service.updatePermissions('t1', FULL_ACCESS, 'missing', ['devices'])).rejects.toThrow(NotFoundException);
    });

    it("validates the new permissions against the user's existing, immutable scope", async () => {
      prisma.user.findFirst.mockResolvedValue({ id: 'u1', tenantId: 't1', customerId: 'c1', permissions: [] });
      await expect(service.updatePermissions('t1', FULL_ACCESS, 'u1', ['contracts'])).rejects.toThrow(BadRequestException);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('updates when the permissions are valid for the existing scope', async () => {
      prisma.user.findFirst.mockResolvedValue({ id: 'u1', tenantId: 't1', customerId: null, permissions: [] });
      prisma.user.update.mockResolvedValue({ id: 'u1', permissions: ['devices', 'tickets'] });

      await service.updatePermissions('t1', FULL_ACCESS, 'u1', ['devices', 'tickets']);

      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'u1' }, data: { permissions: ['devices', 'tickets'] } }),
      );
    });

    it('rejects an actor granting a NEW permission (to themselves or anyone) they do not hold themselves', async () => {
      prisma.user.findFirst.mockResolvedValue({ id: 'self', tenantId: 't1', customerId: null, permissions: ['users'] });

      await expect(service.updatePermissions('t1', ['users'], 'self', ['users', 'billing'])).rejects.toThrow(ForbiddenException);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('allows retaining a permission the target already had even when the actor does not hold it themselves', async () => {
      prisma.user.findFirst.mockResolvedValue({ id: 'u1', tenantId: 't1', customerId: null, permissions: ['billing', 'devices'] });
      prisma.user.update.mockResolvedValue({ id: 'u1', permissions: ['billing', 'tickets'] });

      // Actor lacks 'billing' and 'tickets' but is only touching devices -
      // billing must survive (retained), tickets is newly added and must be
      // rejected since the actor doesn't hold it either.
      await expect(service.updatePermissions('t1', ['users', 'devices'], 'u1', ['billing', 'tickets'])).rejects.toThrow(
        ForbiddenException,
      );
      expect(prisma.user.update).not.toHaveBeenCalled();

      // Same scenario but only retaining billing + dropping devices - no
      // NEW key introduced, so this succeeds even without the actor holding
      // 'billing'.
      await service.updatePermissions('t1', ['users', 'devices'], 'u1', ['billing']);
      expect(prisma.user.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'u1' }, data: { permissions: ['billing'] } }));
    });

    it('allows setting invoices_view on a customer-scoped target regardless of the (tenant-wide) actor own permissions', async () => {
      prisma.user.findFirst.mockResolvedValue({ id: 'cust1', tenantId: 't1', customerId: 'c1', permissions: [] });
      prisma.user.update.mockResolvedValue({ id: 'cust1', permissions: ['invoices_view'] });

      await service.updatePermissions('t1', ['users'], 'cust1', ['invoices_view']);

      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'cust1' }, data: { permissions: ['invoices_view'] } }),
      );
    });
  });
});
