'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { assignDeviceCustomer, updateDeviceLabel } from '@/lib/api';

export async function assignCustomerAction(deviceId: string, formData: FormData) {
  const raw = String(formData.get('customerId') ?? '');

  try {
    await assignDeviceCustomer(deviceId, raw || null);
  } catch {
    redirect(`/devices/${deviceId}?customerError=1`);
  }
  revalidatePath(`/devices/${deviceId}`);
  revalidatePath('/');
  // No client JS on this form (plain Server Action submit), so there's no
  // in-place way to show a toast - redirecting with a query flag is the
  // standard no-JS-safe way to signal success back to the reloaded page.
  redirect(`/devices/${deviceId}?customerSaved=1`);
}

export async function updateLabelAction(deviceId: string, formData: FormData) {
  const raw = String(formData.get('customLabel') ?? '').trim();

  try {
    await updateDeviceLabel(deviceId, raw || null);
  } catch {
    redirect(`/devices/${deviceId}?labelError=1`);
  }
  revalidatePath(`/devices/${deviceId}`);
  revalidatePath('/');
  revalidatePath('/customers');
  redirect(`/devices/${deviceId}?labelSaved=1`);
}
