'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  createCustomerToken,
  createCustomerEnrollmentCode,
  createUser,
  revokeCustomerToken,
  revokeCustomerEnrollmentCode,
  revokeUser,
  updateCustomer,
} from '@/lib/api';

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
  try {
    await revokeCustomerToken(customerId, tokenId);
  } catch {
    redirect(`/customers/${customerId}?tokenError=1`);
  }
  revalidatePath(`/customers/${customerId}`);
  redirect(`/customers/${customerId}?tokenRevoked=1`);
}

interface CreateEnrollmentCodeState {
  code: string | null;
  label: string | null;
  error: string | null;
}

export async function createEnrollmentCodeAction(
  customerId: string,
  _prevState: CreateEnrollmentCodeState,
  formData: FormData,
): Promise<CreateEnrollmentCodeState> {
  const label = String(formData.get('label') ?? '').trim() || undefined;
  try {
    const result = await createCustomerEnrollmentCode(customerId, label);
    revalidatePath(`/customers/${customerId}`);
    return { code: result.code, label: result.label, error: null };
  } catch {
    return { code: null, label: null, error: 'Não foi possível gerar o código. Tente novamente.' };
  }
}

export async function revokeEnrollmentCodeAction(customerId: string, codeId: string) {
  try {
    await revokeCustomerEnrollmentCode(customerId, codeId);
  } catch {
    redirect(`/customers/${customerId}?enrollmentCodeError=1`);
  }
  revalidatePath(`/customers/${customerId}`);
  redirect(`/customers/${customerId}?enrollmentCodeRevoked=1`);
}

// Creates a view-only dashboard login already scoped to this customer - the
// customerId is fixed to the page's own customer, not a free choice, so
// there's no way to accidentally create a login for the wrong client from
// here (unlike the general /users form, which has to ask).
export async function createCustomerUserAction(customerId: string, formData: FormData) {
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  const name = String(formData.get('name') ?? '').trim() || undefined;
  const permissions = formData.getAll('permissions').map(String);

  try {
    await createUser({ email, password, name, customerId, permissions });
  } catch (err) {
    const message = err instanceof Error ? err.message : '';
    redirect(`/customers/${customerId}?userError=${message.includes('already in use') ? 'email_in_use' : '1'}`);
  }

  revalidatePath(`/customers/${customerId}`);
  redirect(`/customers/${customerId}?userCreated=1`);
}

export async function revokeCustomerUserAction(customerId: string, userId: string) {
  try {
    await revokeUser(userId);
  } catch {
    redirect(`/customers/${customerId}?userRevokeError=1`);
  }
  revalidatePath(`/customers/${customerId}`);
  redirect(`/customers/${customerId}?userRevoked=1`);
}

export async function updateCustomerInfoAction(customerId: string, formData: FormData) {
  const document = String(formData.get('document') ?? '').trim() || undefined;
  const address = String(formData.get('address') ?? '').trim() || undefined;

  try {
    await updateCustomer(customerId, { document, address });
  } catch {
    redirect(`/customers/${customerId}?infoError=1`);
  }
  revalidatePath(`/customers/${customerId}`);
  redirect(`/customers/${customerId}?infoSaved=1`);
}

// Same explicit-null-clears convention as slaHoursField below - an empty
// field really does mean "stop emailing this contact", not "leave it
// alone", so it has to be sent as null rather than omitted.
export async function updateCustomerNotifyEmailAction(customerId: string, formData: FormData) {
  const notifyEmail = String(formData.get('notifyEmail') ?? '').trim() || null;

  try {
    await updateCustomer(customerId, { notifyEmail });
  } catch {
    redirect(`/customers/${customerId}?notifyEmailError=1`);
  }
  revalidatePath(`/customers/${customerId}`);
  redirect(`/customers/${customerId}?notifyEmailSaved=1`);
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
  try {
    await updateCustomer(customerId, {
      slaHoursLow: slaHoursField(formData, 'slaHoursLow'),
      slaHoursMedium: slaHoursField(formData, 'slaHoursMedium'),
      slaHoursHigh: slaHoursField(formData, 'slaHoursHigh'),
      slaHoursUrgent: slaHoursField(formData, 'slaHoursUrgent'),
    });
  } catch {
    redirect(`/customers/${customerId}?slaError=1`);
  }
  revalidatePath(`/customers/${customerId}`);
  redirect(`/customers/${customerId}?slaSaved=1`);
}
