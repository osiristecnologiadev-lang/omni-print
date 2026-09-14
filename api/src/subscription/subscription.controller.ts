import { BadRequestException, Controller, Get, Headers, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { UserAuthGuard } from '../auth/user-auth.guard';
import { SubscriptionService } from './subscription.service';

@Controller('v1/subscription')
export class SubscriptionController {
  constructor(private readonly subscriptionService: SubscriptionService) {}

  // Deliberately NOT gated by SubscriptionGuard, unlike every other
  // tenant-facing controller - this is how a blocked tenant un-blocks
  // itself (see SubscriptionGuard's comment on why it excludes this
  // controller).
  @UseGuards(UserAuthGuard)
  @Get()
  status(@Req() req: any) {
    return this.subscriptionService.getStatus(req.tenantId);
  }

  @UseGuards(UserAuthGuard)
  @Post('checkout')
  checkout(@Req() req: any) {
    return this.subscriptionService.createCheckoutSession(req.tenantId);
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
    const event = this.subscriptionService.constructEvent(req.body, signature);
    await this.subscriptionService.handleWebhookEvent(event);
    return { received: true };
  }
}
