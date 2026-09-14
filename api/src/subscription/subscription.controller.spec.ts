import { BadRequestException } from '@nestjs/common';
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
