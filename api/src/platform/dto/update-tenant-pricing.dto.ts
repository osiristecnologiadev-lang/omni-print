import { IsInt, IsOptional, Min } from 'class-validator';

// pricePerDeviceCentsOverride: omit/undefined leaves the pricing endpoint's
// current handling unclear, so the controller treats a present `null`
// explicitly as "clear the override, back to the standard rate" - see
// SubscriptionService.updateTenantPricing. @IsOptional() skips validation
// for both null and undefined, so a real number is still checked below.
export class UpdateTenantPricingDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  pricePerDeviceCentsOverride?: number | null;
}
