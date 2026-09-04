'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createTenantUser } from '@/lib/platform-api';

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
