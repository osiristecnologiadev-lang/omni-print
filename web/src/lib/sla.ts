import type { Ticket } from './api';

// Mirrors the backend's isSlaBreached (api/src/common/sla.util.ts) - a
// ticket resolved before its deadline stays "met" forever, one resolved
// (or still open) past it stays "breached," measured against now only
// while still open.
export function isTicketSlaBreached(ticket: Pick<Ticket, 'slaDueAt' | 'resolvedAt'>, now: Date = new Date()): boolean {
  const dueAt = new Date(ticket.slaDueAt);
  const measuredAt = ticket.resolvedAt ? new Date(ticket.resolvedAt) : now;
  return measuredAt > dueAt;
}
