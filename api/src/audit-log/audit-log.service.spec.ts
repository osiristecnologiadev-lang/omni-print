import { Test } from '@nestjs/testing';
import { AuditLogService } from './audit-log.service';
import { PrismaService } from '../prisma/prisma.service';

describe('AuditLogService', () => {
  let service: AuditLogService;
  let prisma: { auditLogEntry: { create: jest.Mock; findMany: jest.Mock } };

  beforeEach(async () => {
    prisma = { auditLogEntry: { create: jest.fn(), findMany: jest.fn() } };
    const moduleRef = await Test.createTestingModule({
      providers: [AuditLogService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(AuditLogService);
  });

  describe('log', () => {
    it('creates a row with exactly the given shape', async () => {
      prisma.auditLogEntry.create.mockResolvedValue({ id: 'e1' });

      await service.log({
        tenantId: 't1',
        actorType: 'USER',
        actorId: 'u1',
        actorLabel: 'admin@example.com',
        action: 'agent_token.revoke',
        targetType: 'AgentToken',
        targetId: 'tok1',
        targetLabel: 'Matriz',
        metadata: { customerId: 'c1' },
      });

      expect(prisma.auditLogEntry.create).toHaveBeenCalledWith({
        data: {
          tenantId: 't1',
          actorType: 'USER',
          actorId: 'u1',
          actorLabel: 'admin@example.com',
          action: 'agent_token.revoke',
          targetType: 'AgentToken',
          targetId: 'tok1',
          targetLabel: 'Matriz',
          metadata: { customerId: 'c1' },
        },
      });
    });
  });

  describe('listForTenant / listForPlatformAdmins pagination', () => {
    it('scopes by tenantId, orders newest first, and reports no next page when everything fits', async () => {
      const rows = [{ id: 'e2' }, { id: 'e1' }];
      prisma.auditLogEntry.findMany.mockResolvedValue(rows);

      const result = await service.listForTenant('t1', { limit: 50 });

      expect(prisma.auditLogEntry.findMany).toHaveBeenCalledWith({
        where: { tenantId: 't1' },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 51,
      });
      expect(result).toEqual({ entries: rows, nextCursor: null });
    });

    it('reports a nextCursor and trims the extra lookahead row when there are more pages', async () => {
      // limit 2, 3 rows returned (the "+1" lookahead) - only 2 should come back.
      prisma.auditLogEntry.findMany.mockResolvedValue([{ id: 'e3' }, { id: 'e2' }, { id: 'e1' }]);

      const result = await service.listForTenant('t1', { limit: 2 });

      expect(result.entries).toEqual([{ id: 'e3' }, { id: 'e2' }]);
      expect(result.nextCursor).toBe('e2');
    });

    it('passes the cursor through with skip: 1', async () => {
      prisma.auditLogEntry.findMany.mockResolvedValue([]);

      await service.listForTenant('t1', { limit: 50, cursor: 'e5' });

      expect(prisma.auditLogEntry.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ cursor: { id: 'e5' }, skip: 1 }),
      );
    });

    it('listForPlatformAdmins filters by actorType instead of tenantId', async () => {
      prisma.auditLogEntry.findMany.mockResolvedValue([]);

      await service.listForPlatformAdmins({ limit: 50 });

      expect(prisma.auditLogEntry.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { actorType: 'PLATFORM_ADMIN' } }),
      );
    });

    it('adds action/targetType to the where clause only when given', async () => {
      prisma.auditLogEntry.findMany.mockResolvedValue([]);

      await service.listForTenant('t1', { limit: 50, action: 'customer.create', targetType: 'Customer' });

      expect(prisma.auditLogEntry.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { tenantId: 't1', action: 'customer.create', targetType: 'Customer' } }),
      );
    });

    it('turns from/to into a createdAt range, inclusive on both ends', async () => {
      prisma.auditLogEntry.findMany.mockResolvedValue([]);
      const from = new Date('2026-09-01T00:00:00.000Z');
      const to = new Date('2026-09-14T23:59:59.999Z');

      await service.listForTenant('t1', { limit: 50, from, to });

      expect(prisma.auditLogEntry.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { tenantId: 't1', createdAt: { gte: from, lte: to } } }),
      );
    });

    it('an open-ended range (only from, or only to) omits the other bound entirely', async () => {
      prisma.auditLogEntry.findMany.mockResolvedValue([]);
      const from = new Date('2026-09-01T00:00:00.000Z');

      await service.listForTenant('t1', { limit: 50, from });

      expect(prisma.auditLogEntry.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { tenantId: 't1', createdAt: { gte: from } } }),
      );
    });
  });
});
