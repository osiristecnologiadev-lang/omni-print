import { Test } from '@nestjs/testing';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { UsersService } from './users.service';
import { PrismaService } from '../prisma/prisma.service';

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
        service.create('t1', {
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
        service.create('t1', { email: 'novo@example.com', password: 'password1', permissions: ['invoices_view'] }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('defaults a tenant-wide user to full tenant-only access when permissions is omitted', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockImplementation(({ data }) => Promise.resolve({ id: 'u1', ...data }));

      const result = await service.create('t1', { email: 'novo@example.com', password: 'password1' });

      expect(result.permissions).toEqual(
        expect.arrayContaining(['contracts', 'invoices', 'customers', 'agent', 'users', 'devices', 'tickets']),
      );
      expect(result.permissions).not.toContain('invoices_view');
    });

    it('defaults a customer-scoped user to no permissions when omitted', async () => {
      prisma.customer.findFirst.mockResolvedValue({ id: 'c1', tenantId: 't1' });
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockImplementation(({ data }) => Promise.resolve({ id: 'u1', ...data }));

      const result = await service.create('t1', { email: 'cliente@example.com', password: 'password1', customerId: 'c1' });

      expect(result.permissions).toEqual([]);
    });

    it('still rejects a duplicate email', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'existing' });
      await expect(service.create('t1', { email: 'ja@existe.com', password: 'password1' })).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('updatePermissions', () => {
    it('throws NotFoundException for a user outside this tenant', async () => {
      prisma.user.findFirst.mockResolvedValue(null);
      await expect(service.updatePermissions('t1', 'missing', ['devices'])).rejects.toThrow(NotFoundException);
    });

    it('validates the new permissions against the user\'s existing, immutable scope', async () => {
      prisma.user.findFirst.mockResolvedValue({ id: 'u1', tenantId: 't1', customerId: 'c1' });
      await expect(service.updatePermissions('t1', 'u1', ['contracts'])).rejects.toThrow(BadRequestException);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('updates when the permissions are valid for the existing scope', async () => {
      prisma.user.findFirst.mockResolvedValue({ id: 'u1', tenantId: 't1', customerId: null });
      prisma.user.update.mockResolvedValue({ id: 'u1', permissions: ['devices', 'tickets'] });

      await service.updatePermissions('t1', 'u1', ['devices', 'tickets']);

      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'u1' }, data: { permissions: ['devices', 'tickets'] } }),
      );
    });
  });
});
