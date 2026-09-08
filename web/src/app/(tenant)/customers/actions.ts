'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createCustomer } from '@/lib/api';

export async function createCustomerAction(formData: FormData) {
  const name = String(formData.get('name') ?? '').trim();
  if (!name) return;

  try {
    await createCustomer(name);
  } catch {
    redirect('/customers?error=1');
  }
  revalidatePath('/customers');
  redirect('/customers?created=1');
}
