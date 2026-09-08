'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createTenant } from '@/lib/platform-api';

export async function createTenantAction(formData: FormData) {
  const name = String(formData.get('name') ?? '').trim();
  if (!name) return;

  try {
    await createTenant(name);
  } catch {
    redirect('/platform?error=1');
  }
  revalidatePath('/platform');
  redirect('/platform?created=1');
}
