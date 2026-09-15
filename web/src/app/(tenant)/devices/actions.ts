'use server';

import { revalidatePath } from 'next/cache';
import { assignDeviceCustomer } from '@/lib/api';

// One PATCH per device (same endpoint the single-device page already uses)
// rather than a new bulk API - keeps the existing per-device
// "device.reassign_customer" audit trail granularity (see
// AuditLogController) instead of inventing a second, coarser action type
// for the same effect. Promise.allSettled so one bad id (already deleted,
// a stale selection from a since-changed filter) doesn't abort the rest.
export async function bulkAssignDevicesAction(
  deviceIds: string[],
  customerId: string | null,
): Promise<{ failed: number; total: number }> {
  const results = await Promise.allSettled(deviceIds.map((id) => assignDeviceCustomer(id, customerId)));
  const failed = results.filter((r) => r.status === 'rejected').length;

  revalidatePath('/devices');
  revalidatePath('/dashboard');
  revalidatePath('/customers');

  return { failed, total: deviceIds.length };
}
