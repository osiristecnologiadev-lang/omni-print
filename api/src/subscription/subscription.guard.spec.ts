import { Test } from '@nestjs/testing';
import { HttpException, type ExecutionContext } from '@nestjs/common';
import { SubscriptionGuard, isTenantBlocked } from './subscription.guard';
import { PrismaService } from '../prisma/prisma.service';

function contextFor(tenantId: string): ExecutionContext {
  const req: any = { tenantId };
  return { switchToHttp: () => ({ getRequest: () => req }) } as unknown as ExecutionContext;
}

describe('isTenantBlocked', () => {
  it('never blocks an ACTIVE subscription', () => {
    expect(
      isTenantBlocked({ subscriptionStatus: 'ACTIVE', trialEndsAt: new Date('2000-01-01'), pricePerDeviceCentsOverride: null }),
    ).toBe(false);
  });

  it('allows TRIALING before trialEndsAt', () => {
    const future = new Date(Date.now() + 60_000);
    expect(isTenantBlocked({ subscriptionStatus: 'TRIALING', trialEndsAt: future, pricePerDeviceCentsOverride: null })).toBe(
      false,
    );
  });

  it('blocks TRIALING after trialEndsAt', () => {
    const past = new Date(Date.now() - 60_000);
    expect(isTenantBlocked({ subscriptionStatus: 'TRIALING', trialEndsAt: past, pricePerDeviceCentsOverride: null })).toBe(
      true,
    );
  });

  // No grace period for v1 (2026-09-14 decision) - past_due blocks
  // immediately, same as an expired trial.
  it('blocks PAST_DUE immediately, with no grace period', () => {
    expect(isTenantBlocked({ subscriptionStatus: 'PAST_DUE', trialEndsAt: new Date(), pricePerDeviceCentsOverride: null })).toBe(
      true,
    );
  });

  it('blocks CANCELED', () => {
    expect(isTenantBlocked({ subscriptionStatus: 'CANCELED', trialEndsAt: new Date(), pricePerDeviceCentsOverride: null })).toBe(
      true,
    );
  });

  // "Comp this tenant" (2026-09-14 decision, requested so the user can
  // onboard a client for free without them paying anything for now) - a
  // negotiated rate of EXACTLY 0 always wins, regardless of subscription
  // status, expired trial, or even PAST_DUE/CANCELED.
  it('never blocks a tenant with a negotiated rate of exactly 0, regardless of status', () => {
    const past = new Date(Date.now() - 60_000);
    expect(isTenantBlocked({ subscriptionStatus: 'TRIALING', trialEndsAt: past, pricePerDeviceCentsOverride: 0 })).toBe(
      false,
    );
    expect(isTenantBlocked({ subscriptionStatus: 'CANCELED', trialEndsAt: past, pricePerDeviceCentsOverride: 0 })).toBe(
      false,
    );
    expect(isTenantBlocked({ subscriptionStatus: 'PAST_DUE', trialEndsAt: past, pricePerDeviceCentsOverride: 0 })).toBe(
      false,
    );
  });

  // null (no override) must NOT be confused with 0 - only an explicit 0
  // comps the tenant, the standard/default rate still applies normally.
  it('does not treat a null override the same as 0', () => {
    const past = new Date(Date.now() - 60_000);
    expect(isTenantBlocked({ subscriptionStatus: 'TRIALING', trialEndsAt: past, pricePerDeviceCentsOverride: null })).toBe(
      true,
    );
  });
});

describe('SubscriptionGuard', () => {
  let guard: SubscriptionGuard;
  let prisma: { tenant: { findUnique: jest.Mock } };

  beforeEach(async () => {
    prisma = { tenant: { findUnique: jest.fn() } };
    const moduleRef = await Test.createTestingModule({
      providers: [SubscriptionGuard, { provide: PrismaService, useValue: prisma }],
    }).compile();
    guard = moduleRef.get(SubscriptionGuard);
  });

  it('allows an ACTIVE tenant through', async () => {
    prisma.tenant.findUnique.mockResolvedValue({ subscriptionStatus: 'ACTIVE', trialEndsAt: new Date(), pricePerDeviceCentsOverride: null });
    await expect(guard.canActivate(contextFor('t1'))).resolves.toBe(true);
  });

  // Blocking scope: BOTH tenant-wide and customer-scoped users of an
  // unpaid tenant are blocked (2026-09-14 decision) - the guard only ever
  // looks at req.tenantId, never req.customerId, so this is structural,
  // not something that needs a separate test per user scope.
  it('rejects with 402 when the tenant is blocked', async () => {
    const past = new Date(Date.now() - 60_000);
    prisma.tenant.findUnique.mockResolvedValue({ subscriptionStatus: 'TRIALING', trialEndsAt: past, pricePerDeviceCentsOverride: null });

    await expect(guard.canActivate(contextFor('t1'))).rejects.toThrow(HttpException);
    await expect(guard.canActivate(contextFor('t1'))).rejects.toMatchObject({ status: 402 });
  });

  it('rejects when the tenant cannot be found', async () => {
    prisma.tenant.findUnique.mockResolvedValue(null);
    await expect(guard.canActivate(contextFor('missing'))).rejects.toThrow(HttpException);
  });

  it('allows a comped tenant (price override 0) through even with an expired trial', async () => {
    const past = new Date(Date.now() - 60_000);
    prisma.tenant.findUnique.mockResolvedValue({ subscriptionStatus: 'TRIALING', trialEndsAt: past, pricePerDeviceCentsOverride: 0 });

    await expect(guard.canActivate(contextFor('t1'))).resolves.toBe(true);
  });
});
