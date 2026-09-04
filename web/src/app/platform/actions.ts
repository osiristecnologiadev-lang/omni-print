'use server';

import { revalidatePath } from 'next/cache';
import { createTenant } from '@/lib/platform-api';

export async function createTenantAction(formData: FormData) {
  const name = String(formData.get('name') ?? '').trim();
  if (!name) return;
  await createTenant(name);
  revalidatePath('/platform');
}
