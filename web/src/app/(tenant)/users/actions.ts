'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createUser, revokeUser, updateUserPermissions } from '@/lib/api';

export async function createUserAction(formData: FormData) {
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  const name = String(formData.get('name') ?? '').trim() || undefined;
  const customerId = String(formData.get('customerId') ?? '') || null;
  const permissions = formData.getAll('permissions').map(String);

  try {
    await createUser({ email, password, name, customerId, permissions });
  } catch (err) {
    // apiMutate's error message embeds the backend's response body - see
    // src/lib/api.ts. Good enough to distinguish "email taken" from
    // anything else without a dedicated error-code contract for one field.
    const message = err instanceof Error ? err.message : '';
    redirect(message.includes('already in use') ? '/users?error=email_in_use' : '/users?error=1');
  }

  revalidatePath('/users');
  redirect('/users?created=1');
}

export async function revokeUserAction(userId: string) {
  try {
    await revokeUser(userId);
  } catch {
    redirect('/users?revokeError=1');
  }
  revalidatePath('/users');
  redirect('/users?revoked=1');
}

export async function updateUserPermissionsAction(userId: string, formData: FormData) {
  const permissions = formData.getAll('permissions').map(String);
  try {
    await updateUserPermissions(userId, permissions);
  } catch {
    redirect('/users?permissionsError=1');
  }
  revalidatePath('/users');
  redirect('/users?permissionsSaved=1');
}
