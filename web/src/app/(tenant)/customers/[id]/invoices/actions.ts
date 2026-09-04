'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { generateInvoice, markInvoicePaid, cancelInvoice } from '@/lib/api';

export async function generateInvoiceAction(customerId: string, formData: FormData) {
  const year = Number(formData.get('year'));
  const month = Number(formData.get('month'));

  try {
    await generateInvoice(customerId, year, month);
  } catch {
    redirect(`/customers/${customerId}/invoices?error=1`);
  }

  revalidatePath(`/customers/${customerId}/invoices`);
  redirect(`/customers/${customerId}/invoices?generated=1`);
}

export async function markPaidAction(customerId: string, invoiceId: string) {
  await markInvoicePaid(customerId, invoiceId);
  revalidatePath(`/customers/${customerId}/invoices`);
}

export async function cancelInvoiceAction(customerId: string, invoiceId: string) {
  await cancelInvoice(customerId, invoiceId);
  revalidatePath(`/customers/${customerId}/invoices`);
}
