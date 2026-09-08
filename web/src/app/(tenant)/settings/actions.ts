'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { updateTenant } from '@/lib/api';

function str(formData: FormData, name: string): string | undefined {
  return String(formData.get(name) ?? '').trim() || undefined;
}

export async function updateTenantAction(formData: FormData) {
  try {
    await updateTenant({
      name: str(formData, 'name'),
      document: str(formData, 'document'),
      address: str(formData, 'address'),
      phone: str(formData, 'phone'),
      contactEmail: str(formData, 'contactEmail'),
    });
  } catch {
    redirect('/settings?error=1');
  }

  revalidatePath('/settings');
  redirect('/settings?saved=1');
}
