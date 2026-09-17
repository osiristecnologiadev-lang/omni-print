import { Test } from '@nestjs/testing';
import { AgentLogService } from './agent-log.service';
import { PrismaService } from '../prisma/prisma.service';

describe('AgentLogService', () => {
  let service: AgentLogService;
  let prisma: { agentToken: { findUnique: jest.Mock; update: jest.Mock } };

  beforeEach(async () => {
    prisma = { agentToken: { findUnique: jest.fn(), update: jest.fn() } };
    const moduleRef = await Test.createTestingModule({
      providers: [AgentLogService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(AgentLogService);
  });

  describe('hasPendingRequest', () => {
    it('is false when no request was ever made', async () => {
      prisma.agentToken.findUnique.mockResolvedValue({ logRequestedAt: null, logUploadedAt: null });
      expect(await service.hasPendingRequest('tok1')).toBe(false);
    });

    it('is true when requested but never uploaded', async () => {
      prisma.agentToken.findUnique.mockResolvedValue({
        logRequestedAt: new Date('2026-09-17T12:00:00Z'),
        logUploadedAt: null,
      });
      expect(await service.hasPendingRequest('tok1')).toBe(true);
    });

    it('is true when re-requested after the last upload', async () => {
      prisma.agentToken.findUnique.mockResolvedValue({
        logRequestedAt: new Date('2026-09-17T12:00:00Z'),
        logUploadedAt: new Date('2026-09-17T11:00:00Z'),
      });
      expect(await service.hasPendingRequest('tok1')).toBe(true);
    });

    it('is false once the upload is newer than the request (already satisfied)', async () => {
      prisma.agentToken.findUnique.mockResolvedValue({
        logRequestedAt: new Date('2026-09-17T12:00:00Z'),
        logUploadedAt: new Date('2026-09-17T12:05:00Z'),
      });
      expect(await service.hasPendingRequest('tok1')).toBe(false);
    });

    it('is false for an unknown token id', async () => {
      prisma.agentToken.findUnique.mockResolvedValue(null);
      expect(await service.hasPendingRequest('missing')).toBe(false);
    });
  });

  describe('recordUpload', () => {
    it('stores the content and stamps logUploadedAt', async () => {
      prisma.agentToken.update.mockResolvedValue({ id: 'tok1' });
      await service.recordUpload('tok1', 'log line 1\nlog line 2');
      expect(prisma.agentToken.update).toHaveBeenCalledWith({
        where: { id: 'tok1' },
        data: { logContent: 'log line 1\nlog line 2', logUploadedAt: expect.any(Date) },
      });
    });
  });
});
