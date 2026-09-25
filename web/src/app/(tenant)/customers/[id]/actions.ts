'use server';

import { revalidatePath } from 'next/cache';
import { redirect, unstable_rethrow } from 'next/navigation';
import {
  createCustomerEnrollmentCode,
  createUser,
  requestAgentTokenLog,
  requestAgentCommand,
  revokeCustomerToken,
  type AgentCommandType,
  revokeCustomerEnrollmentCode,
  revokeUser,
  updateCustomer,
  updateCustomerDiscoveryRanges,
} from '@/lib/api';

export async function revokeTokenAction(customerId: string, tokenId: string) {
  try {
    await revokeCustomerToken(customerId, tokenId);
  } catch {
    redirect(`/customers/${customerId}?tokenError=1`);
  }
  revalidatePath(`/customers/${customerId}`);
  redirect(`/customers/${customerId}?tokenRevoked=1`);
}

// Doesn't actually deliver the log - just marks the request. The agent
// notices it on its own next check (up to 2 minutes later, see
// agent/internal/svc) and uploads its log tail; the customer page's status
// text ("Aguardando..." / "Ver log") reflects whichever state that's in.
export async function requestLogAction(customerId: string, tokenId: string) {
  try {
    await requestAgentTokenLog(customerId, tokenId);
  } catch {
    redirect(`/customers/${customerId}?logRequestError=1`);
  }
  revalidatePath(`/customers/${customerId}`);
  redirect(`/customers/${customerId}?logRequested=1`);
}

// Same poll-only delivery as requestLogAction - the page's per-token
// status line shows whether the agent has picked it up and what it said.
export async function requestCommandAction(customerId: string, tokenId: string, command: AgentCommandType) {
  try {
    await requestAgentCommand(customerId, tokenId, command);
  } catch {
    redirect(`/customers/${customerId}?commandError=1`);
  }
  revalidatePath(`/customers/${customerId}`);
  redirect(`/customers/${customerId}?commandRequested=1`);
}

export interface DiscoveryRangesState {
  text: string;
  error: string | null;
  saved: boolean;
}

// One range per line; commas/semicolons/spaces also split, since people
// paste lists from spreadsheets and e-mails.
export async function updateDiscoveryRangesAction(
  customerId: string,
  _prevState: DiscoveryRangesState,
  formData: FormData,
): Promise<DiscoveryRangesState> {
  const text = String(formData.get('ranges') ?? '');
  const ranges = text.split(/[\s,;]+/).filter(Boolean);
  try {
    const customer = await updateCustomerDiscoveryRanges(customerId, ranges);
    revalidatePath(`/customers/${customerId}`);
    return { text: customer.discoveryRanges.join('\n'), error: null, saved: true };
  } catch (err) {
    unstable_rethrow(err); // apiMutate's own redirect('/login') / forbidden() must still happen
    return { text, error: apiErrorMessage(err) ?? 'Não foi possível salvar as redes. Tente novamente.', saved: false };
  }
}

// apiMutate's error is "API <method> <path> failed: <status> <body>"; a
// 400's body is Nest's { message } - a string from discovery-ranges.util's
// own checks (already Portuguese), an array from DTO validation (not).
function apiErrorMessage(err: unknown): string | null {
  const raw = err instanceof Error ? err.message : '';
  const match = raw.match(/failed: 400 ([\s\S]*)$/);
  if (!match) return null;
  try {
    const body = JSON.parse(match[1]) as { message?: unknown };
    return typeof body.message === 'string' ? body.message : null;
  } catch {
    return null;
  }
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
