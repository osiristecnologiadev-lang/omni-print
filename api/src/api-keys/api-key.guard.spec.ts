import { UnauthorizedException } from '@nestjs/common';
import { ExecutionContext } from '@nestjs/common';
import { ApiKeyGuard } from './api-key.guard';
import type { PrismaService } from '../prisma/prisma.service';
import { hashToken } from '../auth/token.util';

function contextWithHeader(authorization?: string): ExecutionContext {
  const req: any = { headers: authorization ? { authorization } : {} };
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

describe('ApiKeyGuard', () => {
  let guard: ApiKeyGuard;
  let prisma: { apiKey: { findUnique: jest.Mock; update: jest.Mock } };

  beforeEach(() => {
    prisma = { apiKey: { findUnique: jest.fn(), update: jest.fn().mockResolvedValue(undefined) } };
    guard = new ApiKeyGuard(prisma as unknown as PrismaService);
  });

  it('rejects a missing Authorization header', async () => {
    await expect(guard.canActivate(contextWithHeader())).rejects.toThrow(UnauthorizedException);
  });

  it('rejects an unknown key', async () => {
    prisma.apiKey.findUnique.mockResolvedValue(null);
    await expect(guard.canActivate(contextWithHeader('Bearer omp_wrong'))).rejects.toThrow(UnauthorizedException);
  });

  it('rejects a revoked key', async () => {
    prisma.apiKey.findUnique.mockResolvedValue({ id: 'k1', tenantId: 't1', revokedAt: new Date() });
    await expect(guard.canActivate(contextWithHeader('Bearer omp_revoked'))).rejects.toThrow(UnauthorizedException);
  });

  it('accepts a valid key, sets req.tenantId, and looks it up by hash (never the raw value)', async () => {
    prisma.apiKey.findUnique.mockResolvedValue({ id: 'k1', tenantId: 't1', revokedAt: null });
    const req: any = { headers: { authorization: 'Bearer omp_valid' } };
    const context = { switchToHttp: () => ({ getRequest: () => req }) } as unknown as ExecutionContext;

    const result = await guard.canActivate(context);

    expect(result).toBe(true);
    expect(req.tenantId).toBe('t1');
    expect(prisma.apiKey.findUnique).toHaveBeenCalledWith({ where: { tokenHash: hashToken('omp_valid') } });
  });

  it('touches lastUsedAt on a successful request without blocking on it', async () => {
    prisma.apiKey.findUnique.mockResolvedValue({ id: 'k1', tenantId: 't1', revokedAt: null });
    const req: any = { headers: { authorization: 'Bearer omp_valid' } };
    const context = { switchToHttp: () => ({ getRequest: () => req }) } as unknown as ExecutionContext;

    await guard.canActivate(context);

    expect(prisma.apiKey.update).toHaveBeenCalledWith({ where: { id: 'k1' }, data: { lastUsedAt: expect.any(Date) } });
  });
});
