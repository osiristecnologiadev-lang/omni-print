import { Global, Module } from '@nestjs/common';
import { SubscriptionController } from './subscription.controller';
import { SubscriptionService } from './subscription.service';
import { SubscriptionGuard } from './subscription.guard';

// Global, same as AuthModule - SubscriptionGuard is applied via
// @UseGuards(UserAuthGuard, SubscriptionGuard) across most feature
// modules (devices, customers, ...), which would otherwise each need to
// import this module just to resolve the guard's own DI token.
// SubscriptionService is exported too - PlatformController injects it
// directly to set a tenant's negotiated price (see updateTenantPricing).
@Global()
@Module({
  controllers: [SubscriptionController],
  providers: [SubscriptionService, SubscriptionGuard],
  exports: [SubscriptionGuard, SubscriptionService],
})
export class SubscriptionModule {}
