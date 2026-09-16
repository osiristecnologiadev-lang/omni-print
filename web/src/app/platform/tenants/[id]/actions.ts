'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createTenantUser, updateTenantPricing } from '@/lib/platform-api';

export async function createTenantUserAction(tenantId: string, formData: FormData) {
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  const name = String(formData.get('name') ?? '').trim() || undefined;

  try {
    await createTenantUser(tenantId, { email, password, name });
  } catch (err) {
    const message = err instanceof Error ? err.message : '';
    redirect(`/platform/tenants/${tenantId}?error=${message.includes('already in use') ? 'email_in_use' : '1'}`);
  }

  revalidatePath(`/platform/tenants/${tenantId}`);
  redirect(`/platform/tenants/${tenantId}?created=1`);
}

// Empty input clears the override back to the standard rate (null) - the
// form field holds reais (e.g. "2,50"), converted to cents here since the
// API/Stripe side works in cents throughout. The "comp" checkbox forces 0
// regardless of what's typed in the price field - 0 is also the exact
// value TenantList's "Cortesia" filter/badge checks for, so this is just a
// labeled shortcut for the same convention, not a separate concept.
export async function updateTenantPricingAction(tenantId: string, formData: FormData) {
  const comp = formData.get('comp') === 'on';
  const raw = String(formData.get('pricePerDevice') ?? '').trim();
  let cents: number | null = null;
  if (comp) {
    cents = 0;
  } else if (raw) {
    const reais = Number(raw.replace(',', '.'));
    if (!Number.isFinite(reais) || reais < 0) {
      redirect(`/platform/tenants/${tenantId}?priceError=1`);
    }
    cents = Math.round(reais * 100);
  }

  try {
    await updateTenantPricing(tenantId, cents);
  } catch {
    redirect(`/platform/tenants/${tenantId}?priceError=1`);
  }

  revalidatePath(`/platform/tenants/${tenantId}`);
  revalidatePath('/platform');
  redirect(`/platform/tenants/${tenantId}?priceSaved=1`);
}
