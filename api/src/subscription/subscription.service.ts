import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import Stripe from 'stripe';
import { PrismaService } from '../prisma/prisma.service';
import { StripeService } from '../stripe/stripe.service';
import { isTenantBlocked } from './subscription.guard';
import { effectivePricePerDeviceCents } from './trial.util';

// Built inline via Checkout's/subscription items' own price_data, rather
// than referencing one pre-created Stripe Price object - a negotiated
// per-tenant rate (Tenant.pricePerDeviceCentsOverride) means the unit
// amount varies per tenant, and Stripe Prices are immutable once created,
// so a fixed STRIPE_PRICE_ID couldn't represent that. STRIPE_PRODUCT_ID
// just groups every generated price under one Product in the Stripe
// dashboard/catalog.
function stripePriceData(unitAmountCents: number) {
  const productId = process.env.STRIPE_PRODUCT_ID;
  if (!productId) {
    throw new Error('STRIPE_PRODUCT_ID is not set');
  }
  return {
    currency: 'brl',
    unit_amount: unitAmountCents,
    recurring: { interval: 'month' as const },
    product: productId,
  };
}

// Maps a Stripe subscription's own status string to this app's simplified
// SubscriptionStatus enum. 'active'/'trialing' both map to ACTIVE (a
// Stripe-side 'trialing' status never actually happens in this app's flow -
// Checkout Sessions are created without trial_period_days, since the trial
// is handled entirely app-side via Tenant.trialEndsAt before any Stripe
// subscription exists at all - but mapped defensively in case that ever
// changes). Everything else (past_due/unpaid/incomplete/incomplete_expired)
// -> PAST_DUE; canceled -> CANCELED. No grace period distinction between
// these at the gating layer (see SubscriptionGuard) - kept as separate enum
// values purely so the frontend can show an accurate status label.
function mapStripeStatus(status: Stripe.Subscription.Status): 'ACTIVE' | 'PAST_DUE' | 'CANCELED' {
  if (status === 'active' || status === 'trialing') return 'ACTIVE';
  if (status === 'canceled' || status === 'incomplete_expired') return 'CANCELED';
  return 'PAST_DUE';
}

@Injectable()
export class SubscriptionService {
  private readonly logger = new Logger(SubscriptionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stripe: StripeService,
  ) {}

  private async requireTenant(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) {
      throw new NotFoundException('tenant not found');
    }
    return tenant;
  }

  async getStatus(tenantId: string) {
    const tenant = await this.requireTenant(tenantId);
    const deviceCount = await this.prisma.device.count({ where: { tenantId } });
    const pricePerDeviceCents = effectivePricePerDeviceCents(tenant);
    return {
      status: tenant.subscriptionStatus,
      trialEndsAt: tenant.trialEndsAt,
      deviceCount,
      pricePerDeviceCents,
      estimatedMonthlyCents: deviceCount * pricePerDeviceCents,
      isBlocked: isTenantBlocked(tenant),
    };
  }

  // Creates (or reuses) a Stripe Customer for this tenant, then a hosted
  // Checkout Session for the subscription - quantity is seeded to the
  // tenant's REAL device count right now so the first invoice is correct
  // from day one, rather than starting at an arbitrary 1 and waiting for
  // the nightly sync (see syncDeviceQuantities) to correct it. Stripe
  // requires quantity >= 1 for a licensed price, so a tenant with zero
  // devices still starts a (near-free, since usage-based pricing has no
  // floor) subscription at quantity 1 - a real but minor edge case, noted
  // rather than specially handled.
  async createCheckoutSession(tenantId: string) {
    const tenant = await this.requireTenant(tenantId);

    let stripeCustomerId = tenant.stripeCustomerId;
    if (!stripeCustomerId) {
      const customer = await this.stripe.customers.create({
        name: tenant.name,
        email: tenant.contactEmail ?? undefined,
        metadata: { tenantId },
      });
      stripeCustomerId = customer.id;
      await this.prisma.tenant.update({ where: { id: tenantId }, data: { stripeCustomerId } });
    }

    const deviceCount = await this.prisma.device.count({ where: { tenantId } });
    const appUrl = process.env.APP_URL ?? 'http://localhost:3001';

    const session = await this.stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: stripeCustomerId,
      client_reference_id: tenantId,
      line_items: [{ price_data: stripePriceData(effectivePricePerDeviceCents(tenant)), quantity: Math.max(1, deviceCount) }],
      success_url: `${appUrl}/subscribe?checkout=success`,
      cancel_url: `${appUrl}/subscribe?checkout=cancelled`,
    });

    if (!session.url) {
      throw new Error('Stripe did not return a Checkout Session URL');
    }
    return { url: session.url };
  }

  // Platform-admin-only (see PlatformController) - sets a negotiated
  // per-device rate for this tenant, or clears it back to the standard
  // rate when cents is null. Applied to any already-active Stripe
  // subscription item IMMEDIATELY (Stripe prorates the current period by
  // default, same behavior as a device-count change) rather than waiting
  // for the next billing cycle - a 2026-09-14 product decision. A tenant
  // with no live subscription yet (still trialing, or never subscribed)
  // just has the override stored for the NEXT createCheckoutSession call
  // to pick up.
  async updateTenantPricing(tenantId: string, cents: number | null) {
    const tenant = await this.requireTenant(tenantId);
    const updated = await this.prisma.tenant.update({
      where: { id: tenantId },
      data: { pricePerDeviceCentsOverride: cents },
    });

    if (tenant.stripeSubscriptionItemId) {
      await this.stripe.subscriptionItems.update(tenant.stripeSubscriptionItemId, {
        price_data: stripePriceData(effectivePricePerDeviceCents(updated)),
      });
    }

    return updated;
  }

  // Verifies the webhook signature and dispatches the 3 events this app
  // cares about. Called from SubscriptionController.webhook with the RAW
  // request body (see main.ts's express.raw() carve-out for this route) -
  // Stripe's signature check fails on a JSON-reserialized body, since
  // key order/whitespace isn't guaranteed to round-trip identically.
  constructEvent(rawBody: Buffer, signature: string): Stripe.Event {
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!webhookSecret) {
      throw new Error('STRIPE_WEBHOOK_SECRET is not set');
    }
    return this.stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  }

  async handleWebhookEvent(event: Stripe.Event): Promise<void> {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const tenantId = session.client_reference_id;
        if (!tenantId || !session.subscription) {
          this.logger.warn(`checkout.session.completed with no tenantId/subscription (session ${session.id})`);
          return;
        }
        const subscription = await this.stripe.subscriptions.retrieve(session.subscription as string);
        await this.prisma.tenant.update({
          where: { id: tenantId },
          data: {
            stripeSubscriptionId: subscription.id,
            stripeSubscriptionItemId: subscription.items.data[0]?.id,
            subscriptionStatus: mapStripeStatus(subscription.status),
          },
        });
        break;
      }
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        const tenant = await this.prisma.tenant.findFirst({ where: { stripeSubscriptionId: subscription.id } });
        if (!tenant) {
          this.logger.warn(`${event.type} for unknown subscription ${subscription.id}`);
          return;
        }
        const status = event.type === 'customer.subscription.deleted' ? 'CANCELED' : mapStripeStatus(subscription.status);
        await this.prisma.tenant.update({ where: { id: tenant.id }, data: { subscriptionStatus: status } });
        break;
      }
      default:
        break; // other event types aren't relevant to subscription state
    }
  }

  // Keeps each active tenant's Stripe subscription quantity AND price in
  // sync with its REAL device count / current negotiated rate - Stripe
  // prorates either difference automatically. The price side of this is a
  // self-healing safety net (updateTenantPricing already applies a rate
  // change immediately) - this just guarantees the two can never silently
  // drift apart even if that direct update ever fails partway. Runs
  // nightly (offset 1h from InvoicesService's 2am job to avoid both
  // hitting the DB at once) rather than on every device-count change, to
  // avoid adding a Stripe API call to the hot ingest path (new devices are
  // rare events, but this keeps the two concerns fully decoupled). Same
  // per-tenant try/catch + Logger shape as InvoicesService.generateDueInvoices.
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async syncDeviceQuantities() {
    const tenants = await this.prisma.tenant.findMany({
      where: { subscriptionStatus: 'ACTIVE', stripeSubscriptionItemId: { not: null } },
      select: { id: true, stripeSubscriptionItemId: true, pricePerDeviceCentsOverride: true },
    });

    for (const tenant of tenants) {
      try {
        const deviceCount = await this.prisma.device.count({ where: { tenantId: tenant.id } });
        await this.stripe.subscriptionItems.update(tenant.stripeSubscriptionItemId!, {
          quantity: Math.max(1, deviceCount),
          price_data: stripePriceData(effectivePricePerDeviceCents(tenant)),
        });
      } catch (err) {
        this.logger.error(`failed to sync device quantity/price for tenant ${tenant.id}`, err as Error);
      }
    }
  }
}
