import { Injectable, Logger } from '@nestjs/common';
import Stripe from 'stripe';

// Thin DI wrapper around the Stripe SDK client, same role PrismaService
// plays for PrismaClient (see prisma/prisma.service.ts) - one instance,
// importable anywhere via StripeModule, no re-construction per call site.
// First real external paid-API integration in this codebase; unlike
// PrismaClient there's no connect/disconnect lifecycle to hook into, the
// client is just a configured HTTP wrapper.
//
// Deliberately does NOT throw when STRIPE_SECRET_KEY is missing - this is a
// @Global() provider, so NestFactory.create would eagerly construct it and
// crash the ENTIRE app at boot (every feature, not just billing) for any
// local dev/CI environment that hasn't set up Stripe test keys. Falls back
// to an obviously-fake key instead; any real call then fails with a clear
// Stripe-side auth error at the point of use, not an opaque app-wide crash.
@Injectable()
export class StripeService extends Stripe {
  constructor() {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) {
      new Logger(StripeService.name).warn('STRIPE_SECRET_KEY is not set - subscription/billing calls will fail');
    }
    super(key || 'sk_test_not_configured', { apiVersion: '2025-02-24.acacia' });
  }
}
