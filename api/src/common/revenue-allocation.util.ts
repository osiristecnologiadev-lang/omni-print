export interface DeviceUsage {
  deviceId: string;
  monoPages: number;
  colorPages: number;
}

// Splits an already-correct CUSTOMER-LEVEL usage revenue total across
// devices, proportional to each device's share of real mono/color pages
// printed - NOT a literal "this printer was billed X", since none of this
// app's three pricing models actually bill per device: ALLOWANCE_PLUS_
// OVERAGE pools its allowance across every device on the contract, and
// PER_PAGE's minimum is guaranteed for the whole customer, not any one
// printer (see ContractsService.resolveBilling's own comment on why - this
// is an estimate/allocation, presented to the tenant as such, not a fact
// about how the contract itself was billed).
//
// Split by rate/channel (mono vs color) rather than blending them, since a
// contract commonly prices color much higher than mono - a device that
// prints mostly color should be attributed more revenue per page than one
// printing the same page count in mono. Guarantees the returned values sum
// back exactly to monoRevenueTotal+colorRevenueTotal (each channel's shares
// sum to 1 by construction), so a tenant can trust "per-printer revenue
// adds up to the invoice total."
//
// When a channel's total pages is 0 across every device (the whole
// revenue is a guaranteed minimum or flat fee with zero real usage to
// attribute to - e.g. a brand new contract before any polling), splits
// that channel's revenue evenly across every device instead - the only
// remaining fair option with no real usage signal to allocate by.
export function allocateUsageRevenue(
  devices: DeviceUsage[],
  monoRevenueTotal: number,
  colorRevenueTotal: number,
): Map<string, number> {
  const totalMono = devices.reduce((sum, d) => sum + d.monoPages, 0);
  const totalColor = devices.reduce((sum, d) => sum + d.colorPages, 0);
  const evenShare = devices.length > 0 ? 1 / devices.length : 0;

  const result = new Map<string, number>();
  for (const d of devices) {
    const monoShare = totalMono > 0 ? d.monoPages / totalMono : evenShare;
    const colorShare = totalColor > 0 ? d.colorPages / totalColor : evenShare;
    result.set(d.deviceId, monoRevenueTotal * monoShare + colorRevenueTotal * colorShare);
  }
  return result;
}
