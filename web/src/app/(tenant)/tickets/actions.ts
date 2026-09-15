'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createTicket, addTicketComment, updateTicket, type TicketStatus, type TicketPriority } from '@/lib/api';

function str(formData: FormData, name: string): string | undefined {
  return String(formData.get(name) ?? '').trim() || undefined;
}

// This page has more than one Server Action bound (this one, addTicketCommentAction,
// updateTicketAction) - Next includes its own internal action-routing field
// (`$ACTION_ID_<hash>`) inside the FormData a form action receives. Forwarded
// as-is to the API, the backend's strict DTO validation (forbidNonWhitelisted)
// 400s on that unexpected field - see agent-releases/actions.ts's identical
// comment, where this was first found against real production logs. Rebuild
// the FormData with only the fields each form actually defines before
// forwarding it.
function pick(formData: FormData, fields: string[]): FormData {
  const clean = new FormData();
  for (const field of fields) {
    for (const value of formData.getAll(field)) {
      clean.append(field, value);
    }
  }
  return clean;
}

const CREATE_TICKET_FIELDS = ['subject', 'description', 'priority', 'deviceId', 'attachment'];
const ADD_COMMENT_FIELDS = ['body', 'internal', 'attachment'];

export async function createTicketAction(customerId: string, formData: FormData) {
  let ticketId: string;
  try {
    const ticket = await createTicket(customerId, pick(formData, CREATE_TICKET_FIELDS));
    ticketId = ticket.id;
  } catch {
    redirect(`/tickets/new?customerId=${customerId}&error=1`);
  }
  revalidatePath('/tickets');
  redirect(`/tickets/${ticketId}`);
}

export async function addTicketCommentAction(customerId: string, ticketId: string, formData: FormData) {
  const body = str(formData, 'body');
  if (!body) return;

  try {
    await addTicketComment(customerId, ticketId, pick(formData, ADD_COMMENT_FIELDS));
  } catch {
    redirect(`/tickets/${ticketId}?commentError=1`);
  }
  revalidatePath(`/tickets/${ticketId}`);
  redirect(`/tickets/${ticketId}?commentAdded=1`);
}

export async function updateTicketAction(ticketId: string, formData: FormData) {
  const status = str(formData, 'status') as TicketStatus | undefined;
  const priority = str(formData, 'priority') as TicketPriority | undefined;
  const assignedToRaw = formData.get('assignedToUserId');
  const assignedToUserId = assignedToRaw === null ? undefined : String(assignedToRaw) || null;

  try {
    await updateTicket(ticketId, { status, priority, assignedToUserId });
  } catch {
    redirect(`/tickets/${ticketId}?updateError=1`);
  }
  revalidatePath(`/tickets/${ticketId}`);
  revalidatePath('/tickets');
  redirect(`/tickets/${ticketId}?updated=1`);
}
