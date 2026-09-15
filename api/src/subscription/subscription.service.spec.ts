import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { SubscriptionService } from './subscription.service';
import { PrismaService } from '../prisma/prisma.service';
import { StripeService } from '../stripe/stripe.service';

describe('SubscriptionService', () => {
  let service: SubscriptionService;
  let prisma: {
    tenant: { findUnique: jest.Mock; update: jest.Mock; findFirst: jest.Mock; findMany: jest.Mock };
    device: { count: jest.Mock };
  };
  let stripe: {
    customers: { create: jest.Mock; update: jest.Mock; retrieve: jest.Mock };
    checkout: { sessions: { create: jest.Mock } };
    subscriptions: { retrieve: jest.Mock; update: jest.Mock };
    subscriptionItems: { update: jest.Mock };
    webhooks: { constructEvent: jest.Mock };
    invoices: { list: jest.Mock };
    setupIntents: { create: jest.Mock };
    paymentMethods: { retrieve: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      tenant: { findUnique: jest.fn(), update: jest.fn(), findFirst: jest.fn(), findMany: jest.fn() },
      device: { count: jest.fn() },
    };
    stripe = {
      customers: { create: jest.fn(), update: jest.fn(), retrieve: jest.fn() },
      checkout: { sessions: { create: jest.fn() } },
      subscriptions: { retrieve: jest.fn(), update: jest.fn() },
      subscriptionItems: { update: jest.fn() },
      webhooks: { constructEvent: jest.fn() },
      invoices: { list: jest.fn() },
      setupIntents: { create: jest.fn() },
      paymentMethods: { retrieve: jest.fn() },
    };

    process.env.STRIPE_PRODUCT_ID = 'prod_123';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';

    const moduleRef = await Test.createTestingModule({
      providers: [
        SubscriptionService,
        { provide: PrismaService, useValue: prisma },
        { provide: StripeService, useValue: stripe },
      ],
    }).compile();

    service = moduleRef.get(SubscriptionService);
  });

  describe('getStatus', () => {
    it('computes the estimated monthly cost from the real device count', async () => {
      prisma.tenant.findUnique.mockResolvedValue({
        subscriptionStatus: 'ACTIVE',
        trialEndsAt: new Date(),
      });
      prisma.device.count.mockResolvedValue(7);

      const status = await service.getStatus('t1');

      expect(status.deviceCount).toBe(7);
      expect(status.pricePerDeviceCents).toBe(310);
      expect(status.estimatedMonthlyCents).toBe(7 * 310);
      expect(status.isBlocked).toBe(false);
    });

    it('throws NotFoundException for an unknown tenant', async () => {
      prisma.tenant.findUnique.mockResolvedValue(null);
      await expect(service.getStatus('missing')).rejects.toBeInstanceOf(NotFoundException);
    });

    // A platform admin's negotiated rate must win over the standard price
    // everywhere it's read, not just at checkout time - see
    // effectivePricePerDeviceCents.
    it('uses the tenant negotiated rate instead of the standard price when set', async () => {
      prisma.tenant.findUnique.mockResolvedValue({
        subscriptionStatus: 'ACTIVE',
        trialEndsAt: new Date(),
        pricePerDeviceCentsOverride: 150,
      });
      prisma.device.count.mockResolvedValue(4);

      const status = await service.getStatus('t1');

      expect(status.pricePerDeviceCents).toBe(150);
      expect(status.estimatedMonthlyCents).toBe(4 * 150);
    });

    // "Comp this tenant" (2026-09-14) - a rate of exactly 0 must never
    // block, even with an already-expired trial, and must be surfaced as
    // isComped so the frontend can show something clearer than a
    // negative-days trial countdown.
    it('reports isComped and isBlocked=false for a rate-0 tenant even past its trial', async () => {
      const past = new Date(Date.now() - 60_000);
      prisma.tenant.findUnique.mockResolvedValue({
        subscriptionStatus: 'TRIALING',
        trialEndsAt: past,
        pricePerDeviceCentsOverride: 0,
      });
      prisma.device.count.mockResolvedValue(10);

      const status = await service.getStatus('t1');

      expect(status.pricePerDeviceCents).toBe(0);
      expect(status.estimatedMonthlyCents).toBe(0);
      expect(status.isBlocked).toBe(false);
      expect(status.isComped).toBe(true);
    });

    it('fetches live cancellation/payment-method state from Stripe when a subscription exists', async () => {
      prisma.tenant.findUnique.mockResolvedValue({
        subscriptionStatus: 'ACTIVE',
        trialEndsAt: new Date(),
        stripeSubscriptionId: 'sub_1',
      });
      prisma.device.count.mockResolvedValue(1);
      stripe.subscriptions.retrieve.mockResolvedValue({
        cancel_at_period_end: true,
        current_period_end: 1_800_000_000,
        default_payment_method: { card: { brand: 'visa', last4: '4242' } },
      });

      const status = await service.getStatus('t1');

      expect(stripe.subscriptions.retrieve).toHaveBeenCalledWith('sub_1', { expand: ['default_payment_method'] });
      expect(status.cancelAtPeriodEnd).toBe(true);
      expect(status.currentPeriodEnd).toEqual(new Date(1_800_000_000 * 1000));
      expect(status.paymentMethod).toEqual({ brand: 'visa', last4: '4242' });
    });

    it('defaults cancellation/payment-method fields when there is no live subscription yet', async () => {
      prisma.tenant.findUnique.mockResolvedValue({ subscriptionStatus: 'TRIALING', trialEndsAt: new Date(Date.now() + 100_000) });
      prisma.device.count.mockResolvedValue(0);

      const status = await service.getStatus('t1');

      expect(stripe.subscriptions.retrieve).not.toHaveBeenCalled();
      expect(status.cancelAtPeriodEnd).toBe(false);
      expect(status.currentPeriodEnd).toBeNull();
      expect(status.paymentMethod).toBeNull();
    });

    it('treats an unexpanded (string) default_payment_method as "no card details to show"', async () => {
      prisma.tenant.findUnique.mockResolvedValue({ subscriptionStatus: 'ACTIVE', trialEndsAt: new Date(), stripeSubscriptionId: 'sub_1' });
      prisma.device.count.mockResolvedValue(1);
      stripe.subscriptions.retrieve.mockResolvedValue({
        cancel_at_period_end: false,
        current_period_end: 1_800_000_000,
        default_payment_method: 'pm_not_expanded',
      });

      const status = await service.getStatus('t1');

      expect(status.paymentMethod).toBeNull();
    });

    // A real gap found via live testing: a card can be saved (via the
    // payment-method panel's lazy-create-a-customer flow) well BEFORE any
    // checkout, e.g. during the trial. Without this fallback the saved card
    // stays invisible forever until the tenant actually subscribes, since
    // paymentMethod otherwise only ever comes from the SUBSCRIPTION's own
    // default_payment_method.
    it('falls back to the CUSTOMER default payment method when there is a Stripe customer but no subscription yet', async () => {
      prisma.tenant.findUnique.mockResolvedValue({ subscriptionStatus: 'TRIALING', trialEndsAt: new Date(Date.now() + 100_000), stripeCustomerId: 'cus_1' });
      prisma.device.count.mockResolvedValue(0);
      stripe.customers.retrieve.mockResolvedValue({
        deleted: false,
        invoice_settings: { default_payment_method: { card: { brand: 'visa', last4: '4242' } } },
      });

      const status = await service.getStatus('t1');

      expect(stripe.customers.retrieve).toHaveBeenCalledWith('cus_1', { expand: ['invoice_settings.default_payment_method'] });
      expect(status.paymentMethod).toEqual({ brand: 'visa', last4: '4242' });
      expect(status.cancelAtPeriodEnd).toBe(false);
      expect(status.currentPeriodEnd).toBeNull();
    });

    it('does not fetch the customer at all when neither a subscription nor a customer exists yet', async () => {
      prisma.tenant.findUnique.mockResolvedValue({ subscriptionStatus: 'TRIALING', trialEndsAt: new Date(Date.now() + 100_000) });
      prisma.device.count.mockResolvedValue(0);

      const status = await service.getStatus('t1');

      expect(stripe.customers.retrieve).not.toHaveBeenCalled();
      expect(status.paymentMethod).toBeNull();
    });
  });

  describe('listInvoices', () => {
    it('returns an empty list when the tenant has no Stripe customer yet', async () => {
      prisma.tenant.findUnique.mockResolvedValue({ stripeCustomerId: null });

      const invoices = await service.listInvoices('t1');

      expect(invoices).toEqual([]);
      expect(stripe.invoices.list).not.toHaveBeenCalled();
    });

    it('maps Stripe invoice fields for display', async () => {
      prisma.tenant.findUnique.mockResolvedValue({ stripeCustomerId: 'cus_1' });
      stripe.invoices.list.mockResolvedValue({
        data: [
          {
            id: 'in_1',
            number: 'ACME-0001',
            created: 1_700_000_000,
            amount_paid: 3100,
            currency: 'brl',
            status: 'paid',
            hosted_invoice_url: 'https://invoice.stripe.com/x',
            invoice_pdf: 'https://invoice.stripe.com/x.pdf',
          },
        ],
      });

      const invoices = await service.listInvoices('t1');

      expect(stripe.invoices.list).toHaveBeenCalledWith({ customer: 'cus_1', limit: 24 });
      expect(invoices).toEqual([
        {
          id: 'in_1',
          number: 'ACME-0001',
          createdAt: new Date(1_700_000_000 * 1000),
          amountPaidCents: 3100,
          currency: 'brl',
          status: 'paid',
          hostedInvoiceUrl: 'https://invoice.stripe.com/x',
          invoicePdf: 'https://invoice.stripe.com/x.pdf',
        },
      ]);
    });
  });

  describe('cancelSubscription / reactivateSubscription', () => {
    it('cancelSubscription schedules cancellation at period end, not immediately', async () => {
      prisma.tenant.findUnique.mockResolvedValue({ stripeSubscriptionId: 'sub_1' });

      await service.cancelSubscription('t1');

      expect(stripe.subscriptions.update).toHaveBeenCalledWith('sub_1', { cancel_at_period_end: true });
    });

    it('cancelSubscription throws when there is nothing to cancel', async () => {
      prisma.tenant.findUnique.mockResolvedValue({ stripeSubscriptionId: null });
      await expect(service.cancelSubscription('t1')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('reactivateSubscription clears the scheduled cancellation', async () => {
      prisma.tenant.findUnique.mockResolvedValue({ stripeSubscriptionId: 'sub_1' });

      await service.reactivateSubscription('t1');

      expect(stripe.subscriptions.update).toHaveBeenCalledWith('sub_1', { cancel_at_period_end: false });
    });

    it('reactivateSubscription throws when there is no subscription at all', async () => {
      prisma.tenant.findUnique.mockResolvedValue({ stripeSubscriptionId: null });
      await expect(service.reactivateSubscription('t1')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('createSetupIntent', () => {
    it('creates a Stripe customer first when the tenant does not have one yet', async () => {
      prisma.tenant.findUnique.mockResolvedValue({ id: 't1', name: 'Acme', contactEmail: null, stripeCustomerId: null });
      stripe.customers.create.mockResolvedValue({ id: 'cus_new' });
      stripe.setupIntents.create.mockResolvedValue({ client_secret: 'seti_1_secret' });

      const result = await service.createSetupIntent('t1');

      expect(stripe.customers.create).toHaveBeenCalledWith(expect.objectContaining({ name: 'Acme' }));
      expect(prisma.tenant.update).toHaveBeenCalledWith({ where: { id: 't1' }, data: { stripeCustomerId: 'cus_new' } });
      expect(stripe.setupIntents.create).toHaveBeenCalledWith(
        expect.objectContaining({ customer: 'cus_new', payment_method_types: ['card'] }),
      );
      expect(result).toEqual({ clientSecret: 'seti_1_secret' });
    });

    it('reuses an existing Stripe customer', async () => {
      prisma.tenant.findUnique.mockResolvedValue({ id: 't1', name: 'Acme', stripeCustomerId: 'cus_existing' });
      stripe.setupIntents.create.mockResolvedValue({ client_secret: 'seti_2_secret' });

      await service.createSetupIntent('t1');

      expect(stripe.customers.create).not.toHaveBeenCalled();
      expect(stripe.setupIntents.create).toHaveBeenCalledWith(expect.objectContaining({ customer: 'cus_existing' }));
    });
  });

  describe('confirmPaymentMethod', () => {
    it('throws when the tenant has no Stripe customer at all', async () => {
      prisma.tenant.findUnique.mockResolvedValue({ stripeCustomerId: null });
      await expect(service.confirmPaymentMethod('t1', 'pm_1')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects a payment method that belongs to a different Stripe customer', async () => {
      prisma.tenant.findUnique.mockResolvedValue({ stripeCustomerId: 'cus_1', stripeSubscriptionId: null });
      stripe.paymentMethods.retrieve.mockResolvedValue({ id: 'pm_1', customer: 'cus_OTHER' });

      await expect(service.confirmPaymentMethod('t1', 'pm_1')).rejects.toBeInstanceOf(NotFoundException);
      expect(stripe.customers.update).not.toHaveBeenCalled();
    });

    it('sets the customer AND subscription default payment method when both exist', async () => {
      prisma.tenant.findUnique.mockResolvedValue({ stripeCustomerId: 'cus_1', stripeSubscriptionId: 'sub_1' });
      stripe.paymentMethods.retrieve.mockResolvedValue({ id: 'pm_1', customer: 'cus_1' });

      await service.confirmPaymentMethod('t1', 'pm_1');

      expect(stripe.customers.update).toHaveBeenCalledWith('cus_1', { invoice_settings: { default_payment_method: 'pm_1' } });
      expect(stripe.subscriptions.update).toHaveBeenCalledWith('sub_1', { default_payment_method: 'pm_1' });
    });

    it('skips the subscription update when the tenant has no live subscription yet', async () => {
      prisma.tenant.findUnique.mockResolvedValue({ stripeCustomerId: 'cus_1', stripeSubscriptionId: null });
      stripe.paymentMethods.retrieve.mockResolvedValue({ id: 'pm_1', customer: 'cus_1' });

      await service.confirmPaymentMethod('t1', 'pm_1');

      expect(stripe.customers.update).toHaveBeenCalled();
      expect(stripe.subscriptions.update).not.toHaveBeenCalled();
    });
  });

  describe('createCheckoutSession', () => {
    it('creates a Stripe customer on first checkout and persists its id', async () => {
      prisma.tenant.findUnique.mockResolvedValue({ id: 't1', name: 'Acme', contactEmail: null, stripeCustomerId: null });
      prisma.device.count.mockResolvedValue(3);
      stripe.customers.create.mockResolvedValue({ id: 'cus_new' });
      stripe.checkout.sessions.create.mockResolvedValue({ url: 'https://checkout.stripe.com/session1' });

      const result = await service.createCheckoutSession('t1');

      expect(stripe.customers.create).toHaveBeenCalledWith(expect.objectContaining({ name: 'Acme' }));
      expect(prisma.tenant.update).toHaveBeenCalledWith({ where: { id: 't1' }, data: { stripeCustomerId: 'cus_new' } });
      // Seeded to the REAL current device count, not an arbitrary 1 - so
      // the first invoice is correct from day one (see service comment).
      // Built via price_data (not a fixed Price id) since a tenant's rate
      // can be negotiated per-tenant - see stripePriceData.
      expect(stripe.checkout.sessions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          line_items: [
            { price_data: { currency: 'brl', unit_amount: 310, recurring: { interval: 'month' }, product: 'prod_123' }, quantity: 3 },
          ],
          client_reference_id: 't1',
        }),
      );
      expect(result).toEqual({ url: 'https://checkout.stripe.com/session1' });
    });

    it('reuses an existing Stripe customer instead of creating a new one', async () => {
      prisma.tenant.findUnique.mockResolvedValue({ id: 't1', name: 'Acme', stripeCustomerId: 'cus_existing' });
      prisma.device.count.mockResolvedValue(0);
      stripe.checkout.sessions.create.mockResolvedValue({ url: 'https://checkout.stripe.com/session2' });

      await service.createCheckoutSession('t1');

      expect(stripe.customers.create).not.toHaveBeenCalled();
      // Zero real devices still floors to quantity 1 - Stripe requires a
      // positive quantity for a licensed price (see service comment).
      expect(stripe.checkout.sessions.create).toHaveBeenCalledWith(
        expect.objectContaining({ line_items: [expect.objectContaining({ quantity: 1 })] }),
      );
    });

    it('uses the tenant negotiated rate in the Checkout line item when set', async () => {
      prisma.tenant.findUnique.mockResolvedValue({
        id: 't1',
        name: 'Acme',
        stripeCustomerId: 'cus_existing',
        pricePerDeviceCentsOverride: 500,
      });
      prisma.device.count.mockResolvedValue(2);
      stripe.checkout.sessions.create.mockResolvedValue({ url: 'https://checkout.stripe.com/session3' });

      await service.createCheckoutSession('t1');

      expect(stripe.checkout.sessions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          line_items: [expect.objectContaining({ price_data: expect.objectContaining({ unit_amount: 500 }) })],
        }),
      );
    });
  });

  describe('handleWebhookEvent', () => {
    it('activates the tenant found by client_reference_id on checkout.session.completed', async () => {
      stripe.subscriptions.retrieve.mockResolvedValue({
        id: 'sub_1',
        status: 'active',
        items: { data: [{ id: 'si_1' }] },
      });

      await service.handleWebhookEvent({
        type: 'checkout.session.completed',
        data: { object: { client_reference_id: 't1', subscription: 'sub_1' } },
      } as any);

      expect(prisma.tenant.update).toHaveBeenCalledWith({
        where: { id: 't1' },
        data: { stripeSubscriptionId: 'sub_1', stripeSubscriptionItemId: 'si_1', subscriptionStatus: 'ACTIVE' },
      });
    });

    it('maps a past_due subscription.updated event to PAST_DUE', async () => {
      prisma.tenant.findFirst.mockResolvedValue({ id: 't1' });

      await service.handleWebhookEvent({
        type: 'customer.subscription.updated',
        data: { object: { id: 'sub_1', status: 'past_due' } },
      } as any);

      expect(prisma.tenant.update).toHaveBeenCalledWith({ where: { id: 't1' }, data: { subscriptionStatus: 'PAST_DUE' } });
    });

    it('cancels the tenant on subscription.deleted regardless of the event payload status', async () => {
      prisma.tenant.findFirst.mockResolvedValue({ id: 't1' });

      await service.handleWebhookEvent({
        type: 'customer.subscription.deleted',
        data: { object: { id: 'sub_1', status: 'active' } }, // Stripe's own payload can still say "active" here
      } as any);

      expect(prisma.tenant.update).toHaveBeenCalledWith({ where: { id: 't1' }, data: { subscriptionStatus: 'CANCELED' } });
    });

    it('does nothing for an unrelated event type', async () => {
      await service.handleWebhookEvent({ type: 'invoice.paid', data: { object: {} } } as any);
      expect(prisma.tenant.update).not.toHaveBeenCalled();
    });
  });

  describe('syncDeviceQuantities', () => {
    it('updates Stripe quantity AND price to the real device count/current rate for every active tenant', async () => {
      prisma.tenant.findMany.mockResolvedValue([{ id: 't1', stripeSubscriptionItemId: 'si_1', pricePerDeviceCentsOverride: null }]);
      prisma.device.count.mockResolvedValue(5);

      await service.syncDeviceQuantities();

      expect(stripe.subscriptionItems.update).toHaveBeenCalledWith('si_1', {
        quantity: 5,
        price_data: { currency: 'brl', unit_amount: 310, recurring: { interval: 'month' }, product: 'prod_123' },
      });
    });

    // The price side is a self-healing safety net for a negotiated rate -
    // see the method's own comment.
    it('reconciles a negotiated rate even if it somehow drifted from Stripe', async () => {
      prisma.tenant.findMany.mockResolvedValue([{ id: 't1', stripeSubscriptionItemId: 'si_1', pricePerDeviceCentsOverride: 200 }]);
      prisma.device.count.mockResolvedValue(1);

      await service.syncDeviceQuantities();

      expect(stripe.subscriptionItems.update).toHaveBeenCalledWith(
        'si_1',
        expect.objectContaining({ price_data: expect.objectContaining({ unit_amount: 200 }) }),
      );
    });

    // Mirrors InvoicesService.generateDueInvoices' per-tenant try/catch - one
    // tenant's Stripe failure must not stop the rest of the fleet from syncing.
    it('does not let one tenant failure block the others', async () => {
      prisma.tenant.findMany.mockResolvedValue([
        { id: 't1', stripeSubscriptionItemId: 'si_1', pricePerDeviceCentsOverride: null },
        { id: 't2', stripeSubscriptionItemId: 'si_2', pricePerDeviceCentsOverride: null },
      ]);
      prisma.device.count.mockResolvedValue(2);
      stripe.subscriptionItems.update.mockRejectedValueOnce(new Error('stripe down')).mockResolvedValueOnce({});

      await service.syncDeviceQuantities();

      expect(stripe.subscriptionItems.update).toHaveBeenCalledTimes(2);
      expect(stripe.subscriptionItems.update).toHaveBeenCalledWith('si_2', expect.objectContaining({ quantity: 2 }));
    });
  });

  describe('updateTenantPricing', () => {
    it('stores the override and does not touch Stripe when there is no live subscription yet', async () => {
      prisma.tenant.findUnique.mockResolvedValue({ id: 't1', stripeSubscriptionItemId: null });
      prisma.tenant.update.mockResolvedValue({ id: 't1', stripeSubscriptionItemId: null, pricePerDeviceCentsOverride: 250 });

      await service.updateTenantPricing('t1', 250);

      expect(prisma.tenant.update).toHaveBeenCalledWith({ where: { id: 't1' }, data: { pricePerDeviceCentsOverride: 250 } });
      expect(stripe.subscriptionItems.update).not.toHaveBeenCalled();
    });

    // The core requirement: an already-subscribed tenant's price changes
    // immediately, with Stripe's default proration - not just on the next
    // cycle (2026-09-14 decision).
    it('applies the new rate immediately to an already-active Stripe subscription', async () => {
      prisma.tenant.findUnique.mockResolvedValue({ id: 't1', stripeSubscriptionItemId: 'si_1' });
      prisma.tenant.update.mockResolvedValue({ id: 't1', stripeSubscriptionItemId: 'si_1', pricePerDeviceCentsOverride: 250 });

      await service.updateTenantPricing('t1', 250);

      expect(stripe.subscriptionItems.update).toHaveBeenCalledWith('si_1', {
        price_data: { currency: 'brl', unit_amount: 250, recurring: { interval: 'month' }, product: 'prod_123' },
      });
    });

    it('clears the override back to the standard rate when passed null', async () => {
      prisma.tenant.findUnique.mockResolvedValue({ id: 't1', stripeSubscriptionItemId: 'si_1' });
      prisma.tenant.update.mockResolvedValue({ id: 't1', stripeSubscriptionItemId: 'si_1', pricePerDeviceCentsOverride: null });

      await service.updateTenantPricing('t1', null);

      expect(prisma.tenant.update).toHaveBeenCalledWith({ where: { id: 't1' }, data: { pricePerDeviceCentsOverride: null } });
      expect(stripe.subscriptionItems.update).toHaveBeenCalledWith(
        'si_1',
        expect.objectContaining({ price_data: expect.objectContaining({ unit_amount: 310 }) }),
      );
    });
  });
});
