import { Test } from '@nestjs/testing';
import { AgentLogService } from './agent-log.service';
import { PrismaService } from '../prisma/prisma.service';

describe('AgentLogService', () => {
  let service: AgentLogService;
  let prisma: {
    agentToken: { findUnique: jest.Mock };
    agentLogEntry: { findFirst: jest.Mock; upsert: jest.Mock; deleteMany: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      agentToken: { findUnique: jest.fn() },
      agentLogEntry: { findFirst: jest.fn(), upsert: jest.fn(), deleteMany: jest.fn() },
    };
    const moduleRef = await Test.createTestingModule({
      providers: [AgentLogService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(AgentLogService);
  });

  describe('hasPendingRequest', () => {
    it('is false when no request was ever made', async () => {
      prisma.agentToken.findUnique.mockResolvedValue({ logRequestedAt: null });
      expect(await service.hasPendingRequest('tok1')).toBe(false);
    });

    it('is true when requested but never uploaded', async () => {
      prisma.agentToken.findUnique.mockResolvedValue({ logRequestedAt: new Date('2026-09-17T12:00:00Z') });
      prisma.agentLogEntry.findFirst.mockResolvedValue(null);
      expect(await service.hasPendingRequest('tok1')).toBe(true);
    });

    it('is true when re-requested after the last upload', async () => {
      prisma.agentToken.findUnique.mockResolvedValue({ logRequestedAt: new Date('2026-09-17T12:00:00Z') });
      prisma.agentLogEntry.findFirst.mockResolvedValue({ uploadedAt: new Date('2026-09-17T11:00:00Z') });
      expect(await service.hasPendingRequest('tok1')).toBe(true);
    });

    it('is false once the upload is newer than the request (already satisfied)', async () => {
      prisma.agentToken.findUnique.mockResolvedValue({ logRequestedAt: new Date('2026-09-17T12:00:00Z') });
      prisma.agentLogEntry.findFirst.mockResolvedValue({ uploadedAt: new Date('2026-09-17T12:05:00Z') });
      expect(await service.hasPendingRequest('tok1')).toBe(false);
    });

    it('is false for an unknown token id', async () => {
      prisma.agentToken.findUnique.mockResolvedValue(null);
      expect(await service.hasPendingRequest('missing')).toBe(false);
    });
  });

  describe('recordUpload', () => {
    it('upserts a per-day entry keyed by (agentTokenId, date)', async () => {
      prisma.agentLogEntry.upsert.mockResolvedValue({ id: 'entry1' });
      await service.recordUpload('tok1', '2026-09-18', 'log line 1\nlog line 2');
      expect(prisma.agentLogEntry.upsert).toHaveBeenCalledWith({
        where: { agentTokenId_date: { agentTokenId: 'tok1', date: '2026-09-18' } },
        create: { agentTokenId: 'tok1', date: '2026-09-18', content: 'log line 1\nlog line 2' },
        update: { content: 'log line 1\nlog line 2', uploadedAt: expect.any(Date) },
      });
    });
  });

  describe('pruneOldLogs', () => {
    it('deletes entries older than the retention window', async () => {
      prisma.agentLogEntry.deleteMany.mockResolvedValue({ count: 3 });
      await service.pruneOldLogs();
      expect(prisma.agentLogEntry.deleteMany).toHaveBeenCalledWith({
        where: { date: { lt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) } },
      });
    });
  });
});
