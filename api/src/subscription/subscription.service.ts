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

    // Live Stripe state (cancellation schedule, current period, card on
    // file) is fetched fresh here rather than mirrored into our own DB -
    // this page is viewed rarely (not a hot path), so one extra Stripe call
    // is cheaper than a second source of truth that could drift from
    // Stripe's own (webhooks only update subscriptionStatus, not these
    // finer-grained fields).
    let cancelAtPeriodEnd = false;
    let currentPeriodEnd: Date | null = null;
    let paymentMethod: { brand: string; last4: string } | null = null;
    if (tenant.stripeSubscriptionId) {
      const subscription = await this.stripe.subscriptions.retrieve(tenant.stripeSubscriptionId, {
        expand: ['default_payment_method'],
      });
      cancelAtPeriodEnd = subscription.cancel_at_period_end;
      currentPeriodEnd = new Date(subscription.current_period_end * 1000);
      const pm = subscription.default_payment_method;
      if (pm && typeof pm !== 'string' && pm.card) {
        paymentMethod = { brand: pm.card.brand, last4: pm.card.last4 };
      }
    } else if (tenant.stripeCustomerId) {
      // No live subscription yet (still trialing, or comped-then-cleared) -
      // but a card can still have been saved in advance via the
      // payment-method panel (createSetupIntent lazily creates the Stripe
      // Customer the moment someone opens that panel, well before any
      // checkout). Fall back to the CUSTOMER's own default payment method
      // so it isn't invisible until they actually subscribe.
      const customer = await this.stripe.customers.retrieve(tenant.stripeCustomerId, {
        expand: ['invoice_settings.default_payment_method'],
      });
      if (!customer.deleted) {
        const pm = customer.invoice_settings?.default_payment_method;
        if (pm && typeof pm !== 'string' && pm.card) {
          paymentMethod = { brand: pm.card.brand, last4: pm.card.last4 };
        }
      }
    }

    return {
      status: tenant.subscriptionStatus,
      trialEndsAt: tenant.trialEndsAt,
      deviceCount,
      pricePerDeviceCents,
      estimatedMonthlyCents: deviceCount * pricePerDeviceCents,
      isBlocked: isTenantBlocked(tenant),
      // A negotiated rate of exactly 0 is "comp this tenant" - see
      // isTenantBlocked's comment. A dedicated field rather than making the
      // frontend infer it from pricePerDeviceCents === 0, since that's
      // computed via effectivePricePerDeviceCents and would conflate "no
      // override, standard rate" with "explicitly comped" if the standard
      // rate itself were ever set to 0.
      isComped: tenant.pricePerDeviceCentsOverride === 0,
      cancelAtPeriodEnd,
      currentPeriodEnd,
      paymentMethod,
    };
  }

  // Invoice history for the self-service billing page - read straight from
  // Stripe rather than mirrored into our own DB, same reasoning as the
  // live fields in getStatus above.
  async listInvoices(tenantId: string) {
    const tenant = await this.requireTenant(tenantId);
    if (!tenant.stripeCustomerId) {
      return [];
    }
    const invoices = await this.stripe.invoices.list({ customer: tenant.stripeCustomerId, limit: 24 });
    return invoices.data.map((inv) => ({
      id: inv.id,
      number: inv.number,
      createdAt: new Date(inv.created * 1000),
      amountPaidCents: inv.amount_paid,
      currency: inv.currency,
      status: inv.status,
      hostedInvoiceUrl: inv.hosted_invoice_url ?? null,
      invoicePdf: inv.invoice_pdf ?? null,
    }));
  }

  // Graceful cancel - keeps access through the period already paid for
  // instead of cutting it off immediately (unlike PAST_DUE, which blocks
  // right away - see SubscriptionGuard's comment on that being a deliberate
  // asymmetry: a tenant who explicitly asked to cancel gets to use what
  // they paid for, a tenant who stopped paying doesn't). subscriptionStatus
  // in our own DB isn't touched here - it stays ACTIVE until Stripe's own
  // customer.subscription.deleted webhook fires at the actual period end.
  async cancelSubscription(tenantId: string): Promise<void> {
    const tenant = await this.requireTenant(tenantId);
    if (!tenant.stripeSubscriptionId) {
      throw new NotFoundException('no active subscription to cancel');
    }
    await this.stripe.subscriptions.update(tenant.stripeSubscriptionId, { cancel_at_period_end: true });
  }

  // Undoes a scheduled cancellation before the period actually ends.
  async reactivateSubscription(tenantId: string): Promise<void> {
    const tenant = await this.requireTenant(tenantId);
    if (!tenant.stripeSubscriptionId) {
      throw new NotFoundException('no subscription to reactivate');
    }
    await this.stripe.subscriptions.update(tenant.stripeSubscriptionId, { cancel_at_period_end: false });
  }

  // First step of the embedded (not hosted-redirect) card-update flow: a
  // SetupIntent lets the frontend collect and confirm a new card directly
  // via Stripe Elements/Stripe.js, so raw card data only ever touches
  // Stripe's own iframe, never this server. Creates the Stripe Customer if
  // this tenant somehow doesn't have one yet (e.g. updating a card before
  // ever checking out) - same lazy-create as createCheckoutSession.
  async createSetupIntent(tenantId: string): Promise<{ clientSecret: string }> {
    const tenant = await this.requireTenant(tenantId);

    let stripeCustomerId = tenant.stripeCustomerId;
    if (!stripeCustomerId) {
      const customer = await this.stripe.customers.create({ name: tenant.name, email: tenant.contactEmail ?? undefined, metadata: { tenantId } });
      stripeCustomerId = customer.id;
      await this.prisma.tenant.update({ where: { id: tenantId }, data: { stripeCustomerId } });
    }

    const setupIntent = await this.stripe.setupIntents.create({
      customer: stripeCustomerId,
      payment_method_types: ['card'],
      usage: 'off_session',
    });
    if (!setupIntent.client_secret) {
      throw new Error('Stripe did not return a SetupIntent client secret');
    }
    return { clientSecret: setupIntent.client_secret };
  }

  // Second step: called after the frontend confirms the SetupIntent with
  // Stripe.js and gets back a real PaymentMethod id. Makes it the default
  // for future invoices (customer-level) AND for this specific subscription
  // (subscription-level overrides customer-level if a subscription is
  // already using a different one) - both need setting, Stripe doesn't
  // cascade one to the other automatically.
  async confirmPaymentMethod(tenantId: string, paymentMethodId: string): Promise<void> {
    const tenant = await this.requireTenant(tenantId);
    if (!tenant.stripeCustomerId) {
      throw new NotFoundException('no Stripe customer for this tenant');
    }

    // Ownership check - a paymentMethodId is a Stripe-generated id, not
    // secret, but this still guards against one tenant's client somehow
    // submitting a payment method id that belongs to a DIFFERENT Stripe
    // customer (e.g. a stale/forged value from a previous session).
    const paymentMethod = await this.stripe.paymentMethods.retrieve(paymentMethodId);
    if (paymentMethod.customer !== tenant.stripeCustomerId) {
      throw new NotFoundException('payment method does not belong to this tenant');
    }

    await this.stripe.customers.update(tenant.stripeCustomerId, {
      invoice_settings: { default_payment_method: paymentMethodId },
    });
    if (tenant.stripeSubscriptionId) {
      await this.stripe.subscriptions.update(tenant.stripeSubscriptionId, { default_payment_method: paymentMethodId });
    }
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
