import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Tenant } from '@prisma/client';

// Gates OmniPrint's own billing of the tenant (distinct from
// permissions.util.ts's assertPermission, which gates WHAT a user can do
// within an unblocked tenant) - runs after UserAuthGuard, which must
// already have set req.tenantId. Blocks the ENTIRE tenant (both
// tenant-wide staff and customer-scoped client logins) when unpaid -
// deliberate 2026-09-14 product decision, not a bug: a client of the
// outsourcing company has no separate billing relationship with OmniPrint,
// so there's no "half blocked" state to represent.
//
// Deliberately re-checked fresh on every request via a DB lookup, never
// cached in the JWT - same reasoning as User.permissions (see
// UserAuthGuard's comment): a successful payment must unblock access
// immediately, not after the token's own expiry.
//
// NOT applied to SubscriptionController itself (that's how a blocked
// tenant un-blocks), nor to UsersController/TenantController (account
// administration stays reachable regardless of billing status - see the
// billing-rollout plan for why this boundary was drawn there).
export function isTenantBlocked(tenant: Pick<Tenant, 'subscriptionStatus' | 'trialEndsAt'>): boolean {
  if (tenant.subscriptionStatus === 'ACTIVE') {
    return false;
  }
  if (tenant.subscriptionStatus === 'TRIALING') {
    return new Date() > tenant.trialEndsAt;
  }
  // PAST_DUE / CANCELED - always blocked, no grace period (2026-09-14 v1 decision).
  return true;
}

@Injectable()
export class SubscriptionGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: req.tenantId },
      select: { subscriptionStatus: true, trialEndsAt: true },
    });
    if (!tenant || isTenantBlocked(tenant)) {
      throw new HttpException('subscription inactive', HttpStatus.PAYMENT_REQUIRED);
    }
    return true;
  }
}
