import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { SubscriptionController } from './subscription.controller';
import type { SubscriptionService } from './subscription.service';

// Regression coverage for a real bug found against the live production
// endpoint: an invalid/forged stripe-signature made constructEvent throw,
// which propagated as an uncaught 500 instead of a 400 - wrong on two
// counts (it's a malformed request, not a server fault, and a 500 reads to
// Stripe as "retry the same payload later" instead of "don't bother").
describe('SubscriptionController.webhook', () => {
  let controller: SubscriptionController;
  let subscriptionService: { constructEvent: jest.Mock; handleWebhookEvent: jest.Mock };

  beforeEach(() => {
    subscriptionService = { constructEvent: jest.fn(), handleWebhookEvent: jest.fn() };
    controller = new SubscriptionController(subscriptionService as unknown as SubscriptionService);
  });

  it('returns 400, not 500, when the signature is invalid', async () => {
    subscriptionService.constructEvent.mockImplementation(() => {
      throw new Error('No signatures found matching the expected signature for payload');
    });
    const req: any = { body: Buffer.from('{}') };

    await expect(controller.webhook(req, 'bad-signature')).rejects.toBeInstanceOf(BadRequestException);
    expect(subscriptionService.handleWebhookEvent).not.toHaveBeenCalled();
  });

  it('rejects a missing signature header without calling Stripe at all', async () => {
    const req: any = { body: Buffer.from('{}') };
    await expect(controller.webhook(req, undefined as unknown as string)).rejects.toBeInstanceOf(BadRequestException);
    expect(subscriptionService.constructEvent).not.toHaveBeenCalled();
  });

  it('rejects when the body is not the raw Buffer (express.raw() carve-out missing/misconfigured)', async () => {
    const req: any = { body: { already: 'parsed as json' } };
    await expect(controller.webhook(req, 'some-signature')).rejects.toBeInstanceOf(BadRequestException);
    expect(subscriptionService.constructEvent).not.toHaveBeenCalled();
  });

  it('processes the event when the signature is valid', async () => {
    const fakeEvent = { type: 'checkout.session.completed' };
    subscriptionService.constructEvent.mockReturnValue(fakeEvent);
    const req: any = { body: Buffer.from('{}') };

    const result = await controller.webhook(req, 'good-signature');

    expect(subscriptionService.handleWebhookEvent).toHaveBeenCalledWith(fakeEvent);
    expect(result).toEqual({ received: true });
  });
});

// Billing is a company-level concern - a customer-scoped login (the
// outsource's own end-client) must never be able to touch the TENANT's own
// OmniPrint subscription. Regression coverage for a real gap found while
// building this: every mutating route here used to only check
// UserAuthGuard, so a customer-scoped session could already call checkout
// (a real charge) before this fix.
describe('SubscriptionController billing-mutation routes are staff-only', () => {
  let controller: SubscriptionController;
  let service: {
    createCheckoutSession: jest.Mock;
    listInvoices: jest.Mock;
    cancelSubscription: jest.Mock;
    reactivateSubscription: jest.Mock;
    createSetupIntent: jest.Mock;
    confirmPaymentMethod: jest.Mock;
  };

  const staffReq = { tenantId: 't1', customerId: null, permissions: ['billing'] };
  const staffNoBillingReq = { tenantId: 't1', customerId: null, permissions: ['settings'] };
  const customerReq = { tenantId: 't1', customerId: 'cust1', permissions: ['billing'] };

  beforeEach(() => {
    service = {
      createCheckoutSession: jest.fn().mockResolvedValue({ url: 'https://checkout.stripe.com/x' }),
      listInvoices: jest.fn().mockResolvedValue([]),
      cancelSubscription: jest.fn().mockResolvedValue(undefined),
      reactivateSubscription: jest.fn().mockResolvedValue(undefined),
      createSetupIntent: jest.fn().mockResolvedValue({ clientSecret: 'seti_x' }),
      confirmPaymentMethod: jest.fn().mockResolvedValue(undefined),
    };
    controller = new SubscriptionController(service as unknown as SubscriptionService);
  });

  it.each([
    // Wrapped in an async arrow so a SYNCHRONOUS throw (checkout/invoices/
    // createSetupIntent aren't `async` methods - requireTenantWide throws
    // before any Promise exists) still surfaces as a rejected promise here,
    // same as the two genuinely-async ones (cancel/reactivate/
    // confirmPaymentMethod).
    ['checkout', async () => controller.checkout(customerReq)],
    ['invoices', async () => controller.invoices(customerReq)],
    ['cancel', async () => controller.cancel(customerReq)],
    ['reactivate', async () => controller.reactivate(customerReq)],
    ['createSetupIntent', async () => controller.createSetupIntent(customerReq)],
    ['confirmPaymentMethod', async () => controller.confirmPaymentMethod(customerReq, { paymentMethodId: 'pm_1' })],
  ])('%s rejects a customer-scoped caller with 403', async (_name, call) => {
    await expect(call()).rejects.toBeInstanceOf(ForbiddenException);
  });

  it.each([
    ['checkout', async () => controller.checkout(staffNoBillingReq)],
    ['invoices', async () => controller.invoices(staffNoBillingReq)],
    ['cancel', async () => controller.cancel(staffNoBillingReq)],
    ['reactivate', async () => controller.reactivate(staffNoBillingReq)],
    ['createSetupIntent', async () => controller.createSetupIntent(staffNoBillingReq)],
    ['confirmPaymentMethod', async () => controller.confirmPaymentMethod(staffNoBillingReq, { paymentMethodId: 'pm_1' })],
  ])('%s rejects a tenant-wide staffer who lacks the billing permission', async (_name, call) => {
    await expect(call()).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('checkout succeeds for a tenant-wide (staff) caller', async () => {
    await controller.checkout(staffReq);
    expect(service.createCheckoutSession).toHaveBeenCalledWith('t1');
  });

  it('cancel succeeds for a tenant-wide (staff) caller', async () => {
    const result = await controller.cancel(staffReq);
    expect(service.cancelSubscription).toHaveBeenCalledWith('t1');
    expect(result).toEqual({ ok: true });
  });

  it('confirmPaymentMethod forwards the paymentMethodId for a staff caller', async () => {
    await controller.confirmPaymentMethod(staffReq, { paymentMethodId: 'pm_abc' });
    expect(service.confirmPaymentMethod).toHaveBeenCalledWith('t1', 'pm_abc');
  });

  it('status stays reachable for a customer-scoped caller (unlike every route above)', async () => {
    const statusService = { getStatus: jest.fn().mockResolvedValue({ status: 'ACTIVE' }) };
    const c2 = new SubscriptionController(statusService as unknown as SubscriptionService);
    await expect(c2.status(customerReq)).resolves.toEqual({ status: 'ACTIVE' });
  });
});
