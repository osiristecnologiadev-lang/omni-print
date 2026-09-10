import { Test } from '@nestjs/testing';
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { AgentEnrollmentService } from './agent-enrollment.service';
import { PrismaService } from '../prisma/prisma.service';
import { hashToken } from '../auth/token.util';

// The exchange endpoint hands out a real, long-lived AgentToken given only
// a short code - these tests lock in every rejection path (unknown/
// malformed/revoked/used/expired) and, most importantly, the redemption
// race fix: two near-simultaneous exchanges of the same still-unused code
// must not both succeed and mint two tokens.
describe('AgentEnrollmentService.exchange', () => {
  let service: AgentEnrollmentService;
  let prisma: {
    agentEnrollmentCode: { findUnique: jest.Mock; updateMany: jest.Mock };
    agentToken: { create: jest.Mock };
    $transaction: jest.Mock;
  };

  const VALID_CODE = 'ABCD2345';
  const baseRecord = {
    id: 'code1',
    tenantId: 't1',
    customerId: 'c1',
    label: null as string | null,
    codeHash: hashToken(VALID_CODE),
    usedAt: null as Date | null,
    revokedAt: null as Date | null,
    expiresAt: new Date('2026-09-11T12:00:00Z'),
    agentTokenId: null as string | null,
  };

  beforeEach(async () => {
    prisma = {
      agentEnrollmentCode: { findUnique: jest.fn(), updateMany: jest.fn() },
      agentToken: { create: jest.fn() },
      $transaction: jest.fn(),
    };

    // Runs the callback against the same mocked prisma object, close
    // enough to Prisma's real interactive-transaction shape for these
    // tests (a fresh `tx` client isn't needed - nothing here depends on
    // transaction-scoped isolation being observably different from the
    // outer client in a unit test).
    prisma.$transaction.mockImplementation((fn: (tx: typeof prisma) => unknown) => fn(prisma));

    const moduleRef = await Test.createTestingModule({
      providers: [AgentEnrollmentService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = moduleRef.get(AgentEnrollmentService);
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-09-10T12:00:00Z'));
  });

  afterEach(() => jest.useRealTimers());

  it('rejects a malformed code (wrong length) without touching the database', async () => {
    await expect(service.exchange('SHORT')).rejects.toThrow(UnauthorizedException);
    expect(prisma.agentEnrollmentCode.findUnique).not.toHaveBeenCalled();
  });

  it('rejects an unknown code with a generic message', async () => {
    prisma.agentEnrollmentCode.findUnique.mockResolvedValue(null);
    await expect(service.exchange(VALID_CODE)).rejects.toThrow('invalid or expired code');
  });

  it('rejects a revoked code', async () => {
    prisma.agentEnrollmentCode.findUnique.mockResolvedValue({ ...baseRecord, revokedAt: new Date() });
    await expect(service.exchange(VALID_CODE)).rejects.toThrow('this code has been revoked');
  });

  it('rejects an already-used code', async () => {
    prisma.agentEnrollmentCode.findUnique.mockResolvedValue({ ...baseRecord, usedAt: new Date() });
    await expect(service.exchange(VALID_CODE)).rejects.toThrow('this code has already been used');
  });

  it('rejects an expired code', async () => {
    prisma.agentEnrollmentCode.findUnique.mockResolvedValue({ ...baseRecord, expiresAt: new Date('2026-09-01T00:00:00Z') });
    await expect(service.exchange(VALID_CODE)).rejects.toThrow('this code has expired');
  });

  it('accepts the code with lowercase/dashes/whitespace - normalizes before hashing', async () => {
    prisma.agentEnrollmentCode.findUnique.mockResolvedValue(baseRecord);
    prisma.agentToken.create.mockResolvedValue({ id: 'token1' });
    prisma.agentEnrollmentCode.updateMany.mockResolvedValue({ count: 1 });

    await service.exchange('  abcd-2345 ');

    expect(prisma.agentEnrollmentCode.findUnique).toHaveBeenCalledWith({ where: { codeHash: hashToken(VALID_CODE) } });
  });

  it('on success, mints a real AgentToken and returns tenant_id/agent_token', async () => {
    prisma.agentEnrollmentCode.findUnique.mockResolvedValue(baseRecord);
    prisma.agentToken.create.mockResolvedValue({ id: 'token1' });
    prisma.agentEnrollmentCode.updateMany.mockResolvedValue({ count: 1 });

    const result = await service.exchange(VALID_CODE);

    expect(prisma.agentToken.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ tenantId: 't1', customerId: 'c1' }),
    });
    expect(prisma.agentEnrollmentCode.updateMany).toHaveBeenCalledWith({
      where: { id: 'code1', usedAt: null, revokedAt: null },
      data: { usedAt: expect.any(Date), agentTokenId: 'token1' },
    });
    expect(result.tenant_id).toBe('t1');
    expect(result.agent_token).toMatch(/^\d{16}$/);
  });

  it('rejects the second of two concurrent redemptions of the same still-unused code', async () => {
    prisma.agentEnrollmentCode.findUnique.mockResolvedValue(baseRecord);
    prisma.agentToken.create.mockResolvedValue({ id: 'token1' });
    // Simulates the real-world race this transaction guards against: both
    // requests read the code as unused, but only the first write actually
    // claims the row - the second's conditional updateMany matches 0 rows.
    prisma.agentEnrollmentCode.updateMany.mockResolvedValueOnce({ count: 0 });

    await expect(service.exchange(VALID_CODE)).rejects.toThrow(ConflictException);
  });
});
