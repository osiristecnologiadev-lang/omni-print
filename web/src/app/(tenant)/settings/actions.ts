'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createApiKey, removeTenantLogo, revokeApiKey, updateTenant, uploadTenantLogo } from '@/lib/api';

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
      timezone: str(formData, 'timezone'),
    });
  } catch {
    redirect('/settings?error=1');
  }

  revalidatePath('/settings');
  redirect('/settings?saved=1');
}

export async function uploadLogoAction(formData: FormData) {
  const file = formData.get('logo');
  if (!(file instanceof File) || file.size === 0) {
    redirect('/settings?logoError=empty');
  }

  const uploadForm = new FormData();
  uploadForm.set('logo', file);
  try {
    await uploadTenantLogo(uploadForm);
  } catch {
    redirect('/settings?logoError=1');
  }

  revalidatePath('/settings');
  redirect('/settings?logoSaved=1');
}

export async function removeLogoAction() {
  try {
    await removeTenantLogo();
  } catch {
    redirect('/settings?logoError=1');
  }
  revalidatePath('/settings');
  redirect('/settings?logoRemoved=1');
}

interface CreateApiKeyState {
  key: string | null;
  error: string | null;
}

// Mirrors customers/[id]/actions.ts's createEnrollmentCodeAction - the raw key only
// ever exists in this one response (only its hash is stored), so it has to
// stay on screen after submit without a redirect, hence useActionState
// instead of this file's usual plain <form action={serverAction}> +
// redirect pattern.
export async function createApiKeyAction(_prevState: CreateApiKeyState, formData: FormData): Promise<CreateApiKeyState> {
  const label = str(formData, 'label');
  try {
    const result = await createApiKey(label);
    revalidatePath('/settings');
    return { key: result.key, error: null };
  } catch {
    return { key: null, error: 'Não foi possível gerar a chave. Tente novamente.' };
  }
}

export async function revokeApiKeyAction(id: string) {
  try {
    await revokeApiKey(id);
  } catch {
    redirect('/settings?apiKeyError=1');
  }
  revalidatePath('/settings');
  redirect('/settings?apiKeyRevoked=1');
}
