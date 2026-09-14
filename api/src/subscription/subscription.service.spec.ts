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
    customers: { create: jest.Mock };
    checkout: { sessions: { create: jest.Mock } };
    subscriptions: { retrieve: jest.Mock };
    subscriptionItems: { update: jest.Mock };
    webhooks: { constructEvent: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      tenant: { findUnique: jest.fn(), update: jest.fn(), findFirst: jest.fn(), findMany: jest.fn() },
      device: { count: jest.fn() },
    };
    stripe = {
      customers: { create: jest.fn() },
      checkout: { sessions: { create: jest.fn() } },
      subscriptions: { retrieve: jest.fn() },
      subscriptionItems: { update: jest.fn() },
      webhooks: { constructEvent: jest.fn() },
    };

    process.env.STRIPE_PRICE_ID = 'price_123';
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
      expect(stripe.checkout.sessions.create).toHaveBeenCalledWith(
        expect.objectContaining({ line_items: [{ price: 'price_123', quantity: 3 }], client_reference_id: 't1' }),
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
        expect.objectContaining({ line_items: [{ price: 'price_123', quantity: 1 }] }),
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
    it('updates Stripe quantity to the real device count for every active tenant', async () => {
      prisma.tenant.findMany.mockResolvedValue([{ id: 't1', stripeSubscriptionItemId: 'si_1' }]);
      prisma.device.count.mockResolvedValue(5);

      await service.syncDeviceQuantities();

      expect(stripe.subscriptionItems.update).toHaveBeenCalledWith('si_1', { quantity: 5 });
    });

    // Mirrors InvoicesService.generateDueInvoices' per-tenant try/catch - one
    // tenant's Stripe failure must not stop the rest of the fleet from syncing.
    it('does not let one tenant failure block the others', async () => {
      prisma.tenant.findMany.mockResolvedValue([
        { id: 't1', stripeSubscriptionItemId: 'si_1' },
        { id: 't2', stripeSubscriptionItemId: 'si_2' },
      ]);
      prisma.device.count.mockResolvedValue(2);
      stripe.subscriptionItems.update.mockRejectedValueOnce(new Error('stripe down')).mockResolvedValueOnce({});

      await service.syncDeviceQuantities();

      expect(stripe.subscriptionItems.update).toHaveBeenCalledTimes(2);
      expect(stripe.subscriptionItems.update).toHaveBeenCalledWith('si_2', { quantity: 2 });
    });
  });
});
