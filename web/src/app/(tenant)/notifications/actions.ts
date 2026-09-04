'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { syncNotificationsNow, resolveNotification } from '@/lib/api';

export async function syncNowAction() {
  const result = await syncNotificationsNow();
  revalidatePath('/notifications');
  const hasChanges = result.created > 0 || result.autoResolved > 0;
  redirect(`/notifications?sync=${hasChanges ? 'changes' : 'nothing'}`);
}

export async function resolveNotificationAction(id: string) {
  await resolveNotification(id);
  revalidatePath('/notifications');
}
