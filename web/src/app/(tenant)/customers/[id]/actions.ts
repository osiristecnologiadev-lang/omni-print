'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createCustomerToken, createUser, revokeCustomerToken, revokeUser, updateCustomer } from '@/lib/api';

interface CreateTokenState {
  token: string | null;
  label: string | null;
  error: string | null;
}

export async function createTokenAction(
  customerId: string,
  _prevState: CreateTokenState,
  formData: FormData,
): Promise<CreateTokenState> {
  const label = String(formData.get('label') ?? '').trim() || undefined;
  try {
    const result = await createCustomerToken(customerId, label);
    revalidatePath(`/customers/${customerId}`);
    return { token: result.token, label: result.label, error: null };
  } catch {
    return { token: null, label: null, error: 'Não foi possível gerar o token. Tente novamente.' };
  }
}

export async function revokeTokenAction(customerId: string, tokenId: string) {
  await revokeCustomerToken(customerId, tokenId);
  revalidatePath(`/customers/${customerId}`);
}

// Creates a view-only dashboard login already scoped to this customer - the
// customerId is fixed to the page's own customer, not a free choice, so
// there's no way to accidentally create a login for the wrong client from
// here (unlike the general /users form, which has to ask).
export async function createCustomerUserAction(customerId: string, formData: FormData) {
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  const name = String(formData.get('name') ?? '').trim() || undefined;

  try {
    await createUser({ email, password, name, customerId });
  } catch (err) {
    const message = err instanceof Error ? err.message : '';
    redirect(`/customers/${customerId}?userError=${message.includes('already in use') ? 'email_in_use' : '1'}`);
  }

  revalidatePath(`/customers/${customerId}`);
  redirect(`/customers/${customerId}?userCreated=1`);
}

export async function revokeCustomerUserAction(customerId: string, userId: string) {
  await revokeUser(userId);
  revalidatePath(`/customers/${customerId}`);
}

// Document/address are only used to fill the "cliente" block on the invoice
// PDF (see api's Customer schema comment) - not shown anywhere else, so
// there's no separate confirmation banner, just a silent revalidate.
export async function updateCustomerInfoAction(customerId: string, formData: FormData) {
  const document = String(formData.get('document') ?? '').trim() || undefined;
  const address = String(formData.get('address') ?? '').trim() || undefined;

  await updateCustomer(customerId, { document, address });
  revalidatePath(`/customers/${customerId}`);
}

// An empty field means "use the global default" - sent as null (explicit
// clear) rather than omitted, so a previously-set override actually gets
// removed instead of silently staying in place (see UpdateCustomerDto's
// comment on why undefined vs. null matters here).
function slaHoursField(formData: FormData, name: string): number | null {
  const raw = String(formData.get(name) ?? '').trim();
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : null;
}

export async function updateCustomerSlaAction(customerId: string, formData: FormData) {
  await updateCustomer(customerId, {
    slaHoursLow: slaHoursField(formData, 'slaHoursLow'),
    slaHoursMedium: slaHoursField(formData, 'slaHoursMedium'),
    slaHoursHigh: slaHoursField(formData, 'slaHoursHigh'),
    slaHoursUrgent: slaHoursField(formData, 'slaHoursUrgent'),
  });
  revalidatePath(`/customers/${customerId}`);
}
