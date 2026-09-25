import { Test } from '@nestjs/testing';
import { ConflictException } from '@nestjs/common';
import { CustomersService } from './customers.service';
import { PrismaService } from '../prisma/prisma.service';

// A second command while the first still waits for the agent must be
// refused, not silently replace it (real incident: an UPDATE lost to a
// DISCOVER clicked 37s later).
describe('CustomersService.requestCommand', () => {
  let service: CustomersService;
  let prisma: { customer: { findFirst: jest.Mock }; agentToken: { findFirst: jest.Mock; update: jest.Mock } };
  const now = new Date('2026-09-25T14:37:00Z');

  beforeEach(async () => {
    prisma = {
      customer: { findFirst: jest.fn().mockResolvedValue({ id: 'c1' }) },
      agentToken: { findFirst: jest.fn(), update: jest.fn().mockResolvedValue({ id: 't1' }) },
    };
    const moduleRef = await Test.createTestingModule({
      providers: [CustomersService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(CustomersService);
    jest.useFakeTimers();
    jest.setSystemTime(now);
  });

  afterEach(() => jest.useRealTimers());

  const token = (over: object) => ({ id: 't1', commandType: null, commandRequestedAt: null, commandAckedAt: null, ...over });

  it('refuses while another command is still pending', async () => {
    prisma.agentToken.findFirst.mockResolvedValue(
      token({ commandType: 'UPDATE', commandRequestedAt: new Date(now.getTime() - 37_000) }),
    );
    await expect(service.requestCommand('ten', 'c1', 't1', 'DISCOVER')).rejects.toThrow(ConflictException);
    expect(prisma.agentToken.update).not.toHaveBeenCalled();
  });

  it.each([
    ['no previous command', token({})],
    ['previous one acked', token({ commandType: 'UPDATE', commandRequestedAt: new Date(now.getTime() - 60_000), commandAckedAt: now })],
    ['previous one expired', token({ commandType: 'UPDATE', commandRequestedAt: new Date(now.getTime() - 31 * 60_000) })],
  ])('accepts when %s', async (_label, t) => {
    prisma.agentToken.findFirst.mockResolvedValue(t);
    await service.requestCommand('ten', 'c1', 't1', 'DISCOVER');
    expect(prisma.agentToken.update).toHaveBeenCalled();
  });
});
