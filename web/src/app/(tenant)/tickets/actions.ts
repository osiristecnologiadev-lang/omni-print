'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createTicket, addTicketComment, updateTicket, type TicketPriority, type TicketStatus } from '@/lib/api';

function str(formData: FormData, name: string): string | undefined {
  return String(formData.get(name) ?? '').trim() || undefined;
}

export async function createTicketAction(customerId: string, formData: FormData) {
  const deviceId = str(formData, 'deviceId');
  const ticket = await createTicket(customerId, {
    subject: str(formData, 'subject') ?? '',
    description: str(formData, 'description') ?? '',
    priority: (str(formData, 'priority') as TicketPriority | undefined) ?? undefined,
    deviceId: deviceId || undefined,
  });
  revalidatePath('/tickets');
  redirect(`/tickets/${ticket.id}`);
}

export async function addTicketCommentAction(customerId: string, ticketId: string, formData: FormData) {
  const body = str(formData, 'body');
  if (!body) return;
  await addTicketComment(customerId, ticketId, body);
  revalidatePath(`/tickets/${ticketId}`);
}

export async function updateTicketAction(ticketId: string, formData: FormData) {
  const status = str(formData, 'status') as TicketStatus | undefined;
  const priority = str(formData, 'priority') as TicketPriority | undefined;
  const assignedToRaw = formData.get('assignedToUserId');
  const assignedToUserId = assignedToRaw === null ? undefined : String(assignedToRaw) || null;

  await updateTicket(ticketId, { status, priority, assignedToUserId });
  revalidatePath(`/tickets/${ticketId}`);
  revalidatePath('/tickets');
}
