import { Test } from '@nestjs/testing';
import { AgentCommandService, COMMAND_EXPIRY_MS } from './agent-command.service';
import { PrismaService } from '../prisma/prisma.service';

describe('AgentCommandService', () => {
  let service: AgentCommandService;
  let prisma: { agentToken: { findUnique: jest.Mock; findFirst: jest.Mock; update: jest.Mock } };

  beforeEach(async () => {
    prisma = { agentToken: { findUnique: jest.fn(), findFirst: jest.fn(), update: jest.fn() } };
    const moduleRef = await Test.createTestingModule({
      providers: [AgentCommandService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(AgentCommandService);
  });

  describe('pendingFor', () => {
    it('is null when nothing was requested', async () => {
      prisma.agentToken.findUnique.mockResolvedValue({ commandType: null, commandRequestedAt: null, commandAckedAt: null });
      expect(await service.pendingFor('tok1')).toBeNull();
    });

    it('returns a fresh, unacked request with its exact requestedAt', async () => {
      const requestedAt = new Date(Date.now() - 60_000);
      prisma.agentToken.findUnique.mockResolvedValue({ commandType: 'RESTART', commandRequestedAt: requestedAt, commandAckedAt: null });
      expect(await service.pendingFor('tok1')).toEqual({ command: 'RESTART', requestedAt: requestedAt.toISOString() });
    });

    it('is null once acked', async () => {
      prisma.agentToken.findUnique.mockResolvedValue({
        commandType: 'UPDATE',
        commandRequestedAt: new Date(Date.now() - 60_000),
        commandAckedAt: new Date(),
      });
      expect(await service.pendingFor('tok1')).toBeNull();
    });

    it('is null once expired, so an agent coming back hours later does not act on it', async () => {
      prisma.agentToken.findUnique.mockResolvedValue({
        commandType: 'RESTART',
        commandRequestedAt: new Date(Date.now() - COMMAND_EXPIRY_MS - 1000),
        commandAckedAt: null,
      });
      expect(await service.pendingFor('tok1')).toBeNull();
    });
  });

  describe('ack', () => {
    it('ignores an ack for a request that is no longer the current one', async () => {
      prisma.agentToken.findFirst.mockResolvedValue(null);
      expect(await service.ack('tok1', '2026-09-24T10:00:00.000Z', 'ok')).toBe(false);
      expect(prisma.agentToken.update).not.toHaveBeenCalled();
    });

    it('rejects a malformed requestedAt without touching the DB', async () => {
      expect(await service.ack('tok1', 'not-a-date', 'ok')).toBe(false);
      expect(prisma.agentToken.findFirst).not.toHaveBeenCalled();
    });

    it('keeps the first ack time and updates the result on a second ack', async () => {
      const firstAck = new Date('2026-09-24T10:01:00Z');
      prisma.agentToken.findFirst.mockResolvedValue({ commandAckedAt: firstAck });
      expect(await service.ack('tok1', '2026-09-24T10:00:00.000Z', '3 impressoras encontradas')).toBe(true);
      expect(prisma.agentToken.update).toHaveBeenCalledWith({
        where: { id: 'tok1' },
        data: { commandAckedAt: firstAck, commandResult: '3 impressoras encontradas' },
      });
    });
  });
});
