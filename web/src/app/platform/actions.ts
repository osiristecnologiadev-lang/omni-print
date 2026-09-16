'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createTenant } from '@/lib/platform-api';

export async function createTenantAction(formData: FormData) {
  const name = String(formData.get('name') ?? '').trim();
  if (!name) return;

  let tenant;
  try {
    tenant = await createTenant(name);
  } catch {
    redirect('/platform?error=1');
  }
  revalidatePath('/platform');
  // Land directly on the new tenant's page (where "criar o primeiro login"
  // already lives) instead of back on the list - the admin used to have to
  // find and click into the tenant they just created themselves.
  redirect(`/platform/tenants/${tenant.id}?tenantCreated=1`);
}
