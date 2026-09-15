import { BadRequestException, Body, Controller, ForbiddenException, Get, Headers, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { UserAuthGuard } from '../auth/user-auth.guard';
import { assertPermission } from '../auth/permissions.util';
import { SubscriptionService } from './subscription.service';
import { ConfirmPaymentMethodDto } from './dto/confirm-payment-method.dto';

@Controller('v1/subscription')
export class SubscriptionController {
  constructor(private readonly subscriptionService: SubscriptionService) {}

  // Billing is a company-level concern, gated on its own dedicated
  // permission (not bundled into 'settings' - the user wanted this
  // specifically restricted, not just "anyone who can edit Empresa") - the
  // outsource's own end-customer (a customer-scoped login) must never be
  // able to start/cancel/modify the TENANT's own OmniPrint subscription
  // regardless of permissions, so that check comes first, unconditionally.
  // A real gap this closes: every mutating route below used to only check
  // UserAuthGuard, so any customer-scoped session could already call
  // checkout (start a real charge) before this - found while adding the
  // new cancel/payment-method routes, fixed here rather than left as-is.
  private requireBillingAccess(req: any) {
    if (req.customerId) {
      throw new ForbiddenException('billing is managed by the outsource company, not its customers');
    }
    assertPermission(req, 'billing');
  }

  // Deliberately NOT gated by SubscriptionGuard, unlike every other
  // tenant-facing controller - this is how a blocked tenant un-blocks
  // itself (see SubscriptionGuard's comment on why it excludes this
  // controller). Status itself stays readable by a customer-scoped login
  // too (needed to render the "access blocked" explanation on /subscribe),
  // unlike every other route here.
  @UseGuards(UserAuthGuard)
  @Get()
  status(@Req() req: any) {
    return this.subscriptionService.getStatus(req.tenantId);
  }

  @UseGuards(UserAuthGuard)
  @Get('invoices')
  invoices(@Req() req: any) {
    this.requireBillingAccess(req);
    return this.subscriptionService.listInvoices(req.tenantId);
  }

  @UseGuards(UserAuthGuard)
  @Post('checkout')
  checkout(@Req() req: any) {
    this.requireBillingAccess(req);
    return this.subscriptionService.createCheckoutSession(req.tenantId);
  }

  @UseGuards(UserAuthGuard)
  @Post('cancel')
  async cancel(@Req() req: any) {
    this.requireBillingAccess(req);
    await this.subscriptionService.cancelSubscription(req.tenantId);
    return { ok: true };
  }

  @UseGuards(UserAuthGuard)
  @Post('reactivate')
  async reactivate(@Req() req: any) {
    this.requireBillingAccess(req);
    await this.subscriptionService.reactivateSubscription(req.tenantId);
    return { ok: true };
  }

  @UseGuards(UserAuthGuard)
  @Post('payment-method/setup-intent')
  createSetupIntent(@Req() req: any) {
    this.requireBillingAccess(req);
    return this.subscriptionService.createSetupIntent(req.tenantId);
  }

  @UseGuards(UserAuthGuard)
  @Post('payment-method')
  async confirmPaymentMethod(@Req() req: any, @Body() dto: ConfirmPaymentMethodDto) {
    this.requireBillingAccess(req);
    await this.subscriptionService.confirmPaymentMethod(req.tenantId, dto.paymentMethodId);
    return { ok: true };
  }

  // Public - Stripe calls this directly, authenticated via signature
  // header instead of a bearer token. req.body is the raw Buffer here (not
  // parsed JSON) - see main.ts's express.raw() carve-out registered for
  // this exact path, before the global json() body parser, which
  // signature verification needs (a re-serialized JSON body wouldn't
  // byte-match what Stripe signed).
  @Post('webhook')
  async webhook(@Req() req: Request, @Headers('stripe-signature') signature: string) {
    if (!signature || !Buffer.isBuffer(req.body)) {
      throw new BadRequestException('missing stripe-signature header or body');
    }
    // constructEvent throws Stripe's own StripeSignatureVerificationError on
    // a bad/forged signature - that's a malformed REQUEST, not a server
    // fault, so it must surface as 400, not an uncaught 500 (confirmed this
    // was actually happening against the real production endpoint before
    // this fix). A 400 also tells Stripe not to retry the exact same
    // payload, unlike a 500 which reads as "try again later."
    let event;
    try {
      event = this.subscriptionService.constructEvent(req.body, signature);
    } catch {
      throw new BadRequestException('invalid stripe-signature');
    }
    await this.subscriptionService.handleWebhookEvent(event);
    return { received: true };
  }
}
