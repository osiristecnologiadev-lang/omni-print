'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createTicket, addTicketComment, updateTicket, type TicketPriority, type TicketStatus } from '@/lib/api';

function str(formData: FormData, name: string): string | undefined {
  return String(formData.get(name) ?? '').trim() || undefined;
}

export async function createTicketAction(customerId: string, formData: FormData) {
  const deviceId = str(formData, 'deviceId');
  let ticketId: string;
  try {
    const ticket = await createTicket(customerId, {
      subject: str(formData, 'subject') ?? '',
      description: str(formData, 'description') ?? '',
      priority: (str(formData, 'priority') as TicketPriority | undefined) ?? undefined,
      deviceId: deviceId || undefined,
    });
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
    await addTicketComment(customerId, ticketId, body);
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
