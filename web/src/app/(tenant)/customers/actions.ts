'use server';

import { revalidatePath } from 'next/cache';
import { createCustomer } from '@/lib/api';

export async function createCustomerAction(formData: FormData) {
  const name = String(formData.get('name') ?? '').trim();
  if (!name) return;
  await createCustomer(name);
  revalidatePath('/customers');
}
