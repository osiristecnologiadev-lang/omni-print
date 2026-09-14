export const TRIAL_DAYS = 14;
export const PRICE_PER_DEVICE_CENTS = 310; // R$3,10/device/month - see SubscriptionService

// Shared by every path that creates a new Tenant (SignupService,
// PlatformService.createTenant) so both start the same 14-day, no-card
// trial - see Tenant.trialEndsAt's schema comment.
export function trialEndsAtFromNow(): Date {
  return new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000);
}
