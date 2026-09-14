export const TRIAL_DAYS = 14;
export const PRICE_PER_DEVICE_CENTS = 310; // R$3,10/device/month - the standard rate, see SubscriptionService

// Shared by every path that creates a new Tenant (SignupService,
// PlatformService.createTenant) so both start the same 14-day, no-card
// trial - see Tenant.trialEndsAt's schema comment.
export function trialEndsAtFromNow(): Date {
  return new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000);
}

// A platform admin can negotiate a different per-device rate for a specific
// tenant (Tenant.pricePerDeviceCentsOverride) - everywhere a price is
// needed (checkout, status display, MRR) must go through this instead of
// reading PRICE_PER_DEVICE_CENTS directly, so a negotiated rate is never
// silently ignored in one call site but not another.
export function effectivePricePerDeviceCents(tenant: { pricePerDeviceCentsOverride: number | null }): number {
  return tenant.pricePerDeviceCentsOverride ?? PRICE_PER_DEVICE_CENTS;
}
