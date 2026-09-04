'use server';

import { revalidatePath } from 'next/cache';
import { publishAgentRelease, deleteAgentRelease } from '@/lib/platform-api';

export async function publishAgentReleaseAction(formData: FormData) {
  await publishAgentRelease(formData);
  revalidatePath('/platform/agent-releases');
}

export async function deleteAgentReleaseAction(id: string) {
  await deleteAgentRelease(id);
  revalidatePath('/platform/agent-releases');
}
