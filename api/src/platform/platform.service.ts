import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { effectivePricePerDeviceCents, trialEndsAtFromNow } from '../subscription/trial.util';
import { TENANT_ONLY_PERMISSION_KEYS } from '../auth/permissions.util';

@Injectable()
export class PlatformService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
  ) {}

  // Deliberately no tenantId filter anywhere in this file - this is the one
  // part of the codebase that's supposed to see across every tenant. See
  // PlatformAuthGuard for how access to it is gated.
  async listTenants() {
    const tenants = await this.prisma.tenant.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { customers: true, devices: true, users: true } } },
    });
    // mrr is computed here (device count * price), not read from Stripe -
    // OmniPrint's own portfolio revenue visibility shouldn't depend on a
    // live Stripe call per tenant, and this matches exactly what
    // SubscriptionService.syncDeviceQuantities will converge Stripe's own
    // billed quantity to anyway.
    return tenants.map((tenant) => ({
      ...tenant,
      mrrCents: tenant.subscriptionStatus === 'ACTIVE' ? tenant._count.devices * effectivePricePerDeviceCents(tenant) : 0,
    }));
  }

  // New tenants (whether self-service signup or platform-admin-bootstrapped
  // here) all start the same 14-day no-card trial - see trialEndsAtFromNow.
  createTenant(name: string) {
    return this.prisma.tenant.create({ data: { name, trialEndsAt: trialEndsAtFromNow() } });
  }

  async getTenant(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      include: { _count: { select: { customers: true, devices: true, users: true } } },
    });
    if (!tenant) {
      throw new NotFoundException('tenant not found');
    }
    return tenant;
  }

  async getTenantUsers(tenantId: string) {
    await this.getTenant(tenantId);
    return this.usersService.list(tenantId);
  }

  // Bootstraps a tenant-wide user for a tenant that has none yet (a brand
  // new signup has no way to log in otherwise - see UsersController, which
  // requires an existing tenant-wide user to create more). Reuses
  // UsersService's actual create logic (email-uniqueness check, hashing)
  // rather than duplicating it.
  async createTenantUser(tenantId: string, dto: { email: string; password: string; name?: string }) {
    await this.getTenant(tenantId);
    // A platform admin is a separate auth system entirely (see PlatformAuthGuard)
    // with no tenant-scoped 'permissions' of its own to check against - full
    // access passed here for the same bootstrap reasoning as SignupService.
    return this.usersService.create(tenantId, [...TENANT_ONLY_PERMISSION_KEYS], { ...dto, customerId: null });
  }

  // Fleet-wide agent version visibility - which client installs are still
  // on an old/vulnerable version, and which haven't checked in recently
  // (agent/internal/svc's updateTicker check-in - see AgentToken's schema
  // comment). Tokens that have never checked in (lastCheckinAt null, e.g.
  // an agent build older than this feature, or one that's never reached the
  // internet) are still listed rather than filtered out - that's useful
  // information too, not noise.
  listAgentFleet() {
    return this.prisma.agentToken.findMany({
      where: { revokedAt: null },
      orderBy: { lastCheckinAt: { sort: 'desc', nulls: 'last' } },
      select: {
        id: true,
        label: true,
        lastSeenVersion: true,
        lastCheckinAt: true,
        tenant: { select: { name: true } },
        customer: { select: { name: true } },
      },
    });
  }
}
