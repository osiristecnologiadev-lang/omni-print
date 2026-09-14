import { Test } from '@nestjs/testing';
import { UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UserAuthGuard } from './user-auth.guard';
import { PrismaService } from '../prisma/prisma.service';

// Regression coverage for a real bug: the guard originally only checked
// the JWT's own signature/expiry, so a revoked user's already-issued
// 7-day token kept authenticating until it happened to expire on its own.
// Fixed by re-checking the user row (specifically revokedAt) on every
// request - these tests exist to keep that check from quietly regressing.

function contextWithAuthHeader(header?: string): ExecutionContext {
  const req: any = { headers: header ? { authorization: header } : {} };
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

describe('UserAuthGuard', () => {
  let guard: UserAuthGuard;
  let jwtService: { verifyAsync: jest.Mock };
  let prisma: { user: { findUnique: jest.Mock } };

  beforeEach(async () => {
    jwtService = { verifyAsync: jest.fn() };
    prisma = { user: { findUnique: jest.fn() } };

    const moduleRef = await Test.createTestingModule({
      providers: [
        UserAuthGuard,
        { provide: JwtService, useValue: jwtService },
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    guard = moduleRef.get(UserAuthGuard);
  });

  it('rejects when no bearer token is present', async () => {
    await expect(guard.canActivate(contextWithAuthHeader())).rejects.toThrow(UnauthorizedException);
  });

  it('rejects an otherwise-valid token whose user has been revoked', async () => {
    jwtService.verifyAsync.mockResolvedValue({ sub: 'user-1', tenantId: 't1', customerId: null });
    prisma.user.findUnique.mockResolvedValue({ id: 'user-1', revokedAt: new Date('2026-01-01') });

    await expect(guard.canActivate(contextWithAuthHeader('Bearer valid-signature-token'))).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects a token for a user that no longer exists', async () => {
    jwtService.verifyAsync.mockResolvedValue({ sub: 'ghost-user', tenantId: 't1', customerId: null });
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(guard.canActivate(contextWithAuthHeader('Bearer valid-signature-token'))).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('allows a valid token for a non-revoked user and attaches request context', async () => {
    jwtService.verifyAsync.mockResolvedValue({ sub: 'user-1', tenantId: 't1', customerId: 'cust-1' });
    prisma.user.findUnique.mockResolvedValue({ id: 'user-1', revokedAt: null, permissions: ['invoices_view'] });

    const req: any = { headers: { authorization: 'Bearer valid-signature-token' } };
    const context = { switchToHttp: () => ({ getRequest: () => req }) } as unknown as ExecutionContext;

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(req.tenantId).toBe('t1');
    expect(req.customerId).toBe('cust-1');
    expect(req.userId).toBe('user-1');
    expect(req.permissions).toEqual(['invoices_view']);
  });

  // Proves permissions are read live from the DB on every request, not
  // cached from the JWT payload the way customerId is - this is what lets
  // UsersController.updatePermissions take effect immediately instead of
  // waiting up to 7 days for the caller's token to expire.
  it('reflects a changed permissions row across two requests with the same token', async () => {
    jwtService.verifyAsync.mockResolvedValue({ sub: 'user-1', tenantId: 't1', customerId: null });
    prisma.user.findUnique.mockResolvedValueOnce({ id: 'user-1', revokedAt: null, permissions: ['devices'] });

    const req1: any = { headers: { authorization: 'Bearer same-token' } };
    await guard.canActivate({ switchToHttp: () => ({ getRequest: () => req1 }) } as unknown as ExecutionContext);
    expect(req1.permissions).toEqual(['devices']);

    prisma.user.findUnique.mockResolvedValueOnce({ id: 'user-1', revokedAt: null, permissions: ['devices', 'reports'] });

    const req2: any = { headers: { authorization: 'Bearer same-token' } };
    await guard.canActivate({ switchToHttp: () => ({ getRequest: () => req2 }) } as unknown as ExecutionContext);
    expect(req2.permissions).toEqual(['devices', 'reports']);
  });
});
