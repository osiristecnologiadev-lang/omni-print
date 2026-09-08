'use server';

import { revalidatePath } from 'next/cache';
import { publishAgentRelease, deleteAgentRelease } from '@/lib/platform-api';

// This page has a second Server Action (deleteAgentReleaseAction.bind, one
// per release row) alongside this form - with more than one action bound
// on the page, Next includes its own internal action-routing field
// (`$ACTION_ID_<hash>`) literally inside the FormData this function
// receives, not just in a header Next strips before handing off. Forwarded
// as-is, the backend's strict DTO validation (forbidNonWhitelisted) 400s on
// that unexpected field - confirmed against real production logs. Rebuild
// the FormData with only the fields this form actually defines before
// forwarding it.
const RELEASE_FORM_FIELDS = ['platform', 'version', 'mandatory', 'releaseNotes', 'file', 'installer'];

export async function publishAgentReleaseAction(formData: FormData) {
  const clean = new FormData();
  for (const field of RELEASE_FORM_FIELDS) {
    for (const value of formData.getAll(field)) {
      clean.append(field, value);
    }
  }
  await publishAgentRelease(clean);
  revalidatePath('/platform/agent-releases');
}

export async function deleteAgentReleaseAction(id: string) {
  await deleteAgentRelease(id);
  revalidatePath('/platform/agent-releases');
}
