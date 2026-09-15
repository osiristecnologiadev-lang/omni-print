'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { syncNotificationsNow, resolveNotification, updateNotificationEmailPreferences, type NotificationType } from '@/lib/api';

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

export async function updateEmailPreferencesAction(formData: FormData) {
  const emailEnabled = formData.get('emailEnabled') === 'on';
  // A plain HTML form only sends the checkboxes that were actually
  // checked - "nothing checked" arrives as no `emailTypes` entries at
  // all, not an empty-string one, so getAll already gives exactly the
  // selected set with no further filtering needed.
  const emailTypes = formData.getAll('emailTypes') as NotificationType[];

  try {
    await updateNotificationEmailPreferences({ emailEnabled, emailTypes });
  } catch {
    redirect('/notifications?prefsError=1');
  }
  revalidatePath('/notifications');
  redirect('/notifications?prefsSaved=1');
}
