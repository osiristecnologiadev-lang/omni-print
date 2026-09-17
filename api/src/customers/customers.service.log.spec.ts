import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { CustomersService } from './customers.service';
import { PrismaService } from '../prisma/prisma.service';

// Scoped to requestLog/getLog only - see customers.service.spec.ts's own
// comment on why this project splits CustomersService coverage by feature
// rather than one giant file.
describe('CustomersService log pull', () => {
  let service: CustomersService;
  let prisma: {
    customer: { findFirst: jest.Mock };
    agentToken: { findFirst: jest.Mock; update: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      customer: { findFirst: jest.fn() },
      agentToken: { findFirst: jest.fn(), update: jest.fn() },
    };
    const moduleRef = await Test.createTestingModule({
      providers: [CustomersService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(CustomersService);
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-09-17T21:00:00Z'));
  });

  afterEach(() => jest.useRealTimers());

  describe('requestLog', () => {
    it('throws when the customer does not belong to this tenant', async () => {
      prisma.customer.findFirst.mockResolvedValue(null);
      await expect(service.requestLog('t1', 'wrong-customer', 'tok1')).rejects.toThrow(NotFoundException);
      expect(prisma.agentToken.update).not.toHaveBeenCalled();
    });

    it('throws when the token does not belong to this customer', async () => {
      prisma.customer.findFirst.mockResolvedValue({ id: 'c1', tenantId: 't1' });
      prisma.agentToken.findFirst.mockResolvedValue(null);
      await expect(service.requestLog('t1', 'c1', 'wrong-token')).rejects.toThrow(NotFoundException);
      expect(prisma.agentToken.update).not.toHaveBeenCalled();
    });

    it('stamps logRequestedAt with now, regardless of any prior value', async () => {
      prisma.customer.findFirst.mockResolvedValue({ id: 'c1', tenantId: 't1' });
      prisma.agentToken.findFirst.mockResolvedValue({ id: 'tok1', tenantId: 't1', customerId: 'c1' });
      prisma.agentToken.update.mockResolvedValue({ id: 'tok1' });

      await service.requestLog('t1', 'c1', 'tok1');

      expect(prisma.agentToken.update).toHaveBeenCalledWith({
        where: { id: 'tok1' },
        data: { logRequestedAt: new Date('2026-09-17T21:00:00Z') },
      });
    });
  });

  describe('getLog', () => {
    it('throws when the token does not belong to this customer', async () => {
      prisma.customer.findFirst.mockResolvedValue({ id: 'c1', tenantId: 't1' });
      prisma.agentToken.findFirst.mockResolvedValue(null);
      await expect(service.getLog('t1', 'c1', 'wrong-token')).rejects.toThrow(NotFoundException);
    });

    it('returns only content + uploadedAt, scoped via a tenantId+customerId+id lookup', async () => {
      prisma.customer.findFirst.mockResolvedValue({ id: 'c1', tenantId: 't1' });
      prisma.agentToken.findFirst.mockResolvedValue({
        logContent: 'line 1\nline 2',
        logUploadedAt: new Date('2026-09-17T20:00:00Z'),
      });

      const result = await service.getLog('t1', 'c1', 'tok1');

      expect(prisma.agentToken.findFirst).toHaveBeenCalledWith({
        where: { id: 'tok1', tenantId: 't1', customerId: 'c1' },
        select: { logContent: true, logUploadedAt: true },
      });
      expect(result).toEqual({ logContent: 'line 1\nline 2', logUploadedAt: new Date('2026-09-17T20:00:00Z') });
    });
  });
});
