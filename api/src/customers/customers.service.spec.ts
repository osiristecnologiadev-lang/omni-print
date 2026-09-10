import { Test } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { CustomersService } from './customers.service';
import { PrismaService } from '../prisma/prisma.service';

// Covers the enrollment-code methods only (createEnrollmentCode/
// listEnrollmentCodes/revokeEnrollmentCode) - this is the first test file
// for CustomersService, scoped to the new feature rather than retrofitting
// coverage for everything else in the service.
describe('CustomersService enrollment codes', () => {
  let service: CustomersService;
  let prisma: {
    customer: { findFirst: jest.Mock };
    agentEnrollmentCode: { findMany: jest.Mock; create: jest.Mock; findFirst: jest.Mock; update: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      customer: { findFirst: jest.fn() },
      agentEnrollmentCode: {
        findMany: jest.fn(),
        create: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
      },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [CustomersService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = moduleRef.get(CustomersService);
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-09-10T12:00:00Z'));
  });

  afterEach(() => jest.useRealTimers());

  describe('createEnrollmentCode', () => {
    it('throws when the customer does not belong to this tenant', async () => {
      prisma.customer.findFirst.mockResolvedValue(null);
      await expect(service.createEnrollmentCode('t1', 'missing-customer')).rejects.toThrow(NotFoundException);
      expect(prisma.agentEnrollmentCode.create).not.toHaveBeenCalled();
    });

    it('stores only a hash, sets a 24h expiry, and returns the raw code exactly once', async () => {
      prisma.customer.findFirst.mockResolvedValue({ id: 'c1', tenantId: 't1' });
      prisma.agentEnrollmentCode.create.mockImplementation(({ data }) =>
        Promise.resolve({ id: 'code1', label: data.label, createdAt: new Date('2026-09-10T12:00:00Z'), expiresAt: data.expiresAt }),
      );

      const result = await service.createEnrollmentCode('t1', 'c1', 'Matriz');

      expect(prisma.agentEnrollmentCode.create).toHaveBeenCalledTimes(1);
      const createArgs = prisma.agentEnrollmentCode.create.mock.calls[0][0];
      expect(createArgs.data.tenantId).toBe('t1');
      expect(createArgs.data.customerId).toBe('c1');
      expect(createArgs.data.label).toBe('Matriz');
      // Only a hash goes to the DB - the raw code never appears in the
      // create() call, same invariant as AgentToken.tokenHash.
      expect(createArgs.data.codeHash).toEqual(expect.any(String));
      expect(createArgs.data.codeHash).not.toEqual(result.code);
      expect(createArgs.data.expiresAt.getTime()).toBe(new Date('2026-09-10T12:00:00Z').getTime() + 24 * 60 * 60 * 1000);

      // Displayed grouped "XXXX-XXXX", 8 real characters.
      expect(result.code).toMatch(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}$/);
    });
  });

  describe('listEnrollmentCodes', () => {
    it('excludes the hash from the returned rows', async () => {
      prisma.customer.findFirst.mockResolvedValue({ id: 'c1', tenantId: 't1' });
      prisma.agentEnrollmentCode.findMany.mockResolvedValue([]);

      await service.listEnrollmentCodes('t1', 'c1');

      const selectArg = prisma.agentEnrollmentCode.findMany.mock.calls[0][0].select;
      expect(selectArg.codeHash).toBeUndefined();
      expect(selectArg.id).toBe(true);
      expect(selectArg.agentTokenId).toBe(true);
    });
  });

  describe('revokeEnrollmentCode', () => {
    it('throws NotFoundException for a code outside this tenant/customer', async () => {
      prisma.customer.findFirst.mockResolvedValue({ id: 'c1', tenantId: 't1' });
      prisma.agentEnrollmentCode.findFirst.mockResolvedValue(null);
      await expect(service.revokeEnrollmentCode('t1', 'c1', 'missing')).rejects.toThrow(NotFoundException);
    });

    it('refuses to revoke an already-used code', async () => {
      prisma.customer.findFirst.mockResolvedValue({ id: 'c1', tenantId: 't1' });
      prisma.agentEnrollmentCode.findFirst.mockResolvedValue({ id: 'code1', usedAt: new Date() });
      await expect(service.revokeEnrollmentCode('t1', 'c1', 'code1')).rejects.toThrow(ConflictException);
      expect(prisma.agentEnrollmentCode.update).not.toHaveBeenCalled();
    });

    it('sets revokedAt on a still-pending code', async () => {
      prisma.customer.findFirst.mockResolvedValue({ id: 'c1', tenantId: 't1' });
      prisma.agentEnrollmentCode.findFirst.mockResolvedValue({ id: 'code1', usedAt: null });
      prisma.agentEnrollmentCode.update.mockResolvedValue({ id: 'code1', revokedAt: new Date() });

      await service.revokeEnrollmentCode('t1', 'c1', 'code1');

      expect(prisma.agentEnrollmentCode.update).toHaveBeenCalledWith({
        where: { id: 'code1' },
        data: { revokedAt: expect.any(Date) },
      });
    });
  });
});
