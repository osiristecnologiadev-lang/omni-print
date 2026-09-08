'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { syncNotificationsNow, resolveNotification } from '@/lib/api';

export async function syncNowAction() {
  let hasChanges = false;
  try {
    const result = await syncNotificationsNow();
    hasChanges = result.created > 0 || result.autoResolved > 0;
  } catch {
    redirect('/notifications?sync=error');
  }
  revalidatePath('/notifications');
  redirect(`/notifications?sync=${hasChanges ? 'changes' : 'nothing'}`);
}

export async function resolveNotificationAction(id: string) {
  try {
    await resolveNotification(id);
  } catch {
    redirect('/notifications?resolveError=1');
  }
  revalidatePath('/notifications');
  redirect('/notifications?resolved=1');
}
