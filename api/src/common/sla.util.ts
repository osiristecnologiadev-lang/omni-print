export type TicketPriorityKey = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';

// SLA response-time targets per ticket priority, in hours. Calendar hours,
// not business-hours-aware (a real MSP helpdesk usually excludes nights/
// weekends) - a deliberate simplification, not an oversight: business-hours
// math needs a timezone and a working-hours calendar per tenant, neither of
// which exists anywhere else in this app yet. Revisit if a real customer
// finds the calendar-hours version misleading.
export const SLA_HOURS_BY_PRIORITY: Record<TicketPriorityKey, number> = {
  URGENT: 4,
  HIGH: 24,
  MEDIUM: 48,
  LOW: 72,
};

// A customer can override any subset of the global defaults (e.g. a bigger
// client negotiates a 2h urgent SLA instead of the default 4h) - shaped
// exactly like Customer.slaHours{Low,Medium,High,Urgent} on the Prisma
// model, null/undefined per field meaning "use the global default for that
// priority," not "zero hours."
export interface CustomerSlaOverrides {
  slaHoursLow?: number | null;
  slaHoursMedium?: number | null;
  slaHoursHigh?: number | null;
  slaHoursUrgent?: number | null;
}

const OVERRIDE_FIELD_BY_PRIORITY: Record<TicketPriorityKey, keyof CustomerSlaOverrides> = {
  LOW: 'slaHoursLow',
  MEDIUM: 'slaHoursMedium',
  HIGH: 'slaHoursHigh',
  URGENT: 'slaHoursUrgent',
};

export function resolveSlaHours(priority: TicketPriorityKey, overrides?: CustomerSlaOverrides | null): number {
  const override = overrides?.[OVERRIDE_FIELD_BY_PRIORITY[priority]];
  return override ?? SLA_HOURS_BY_PRIORITY[priority];
}

export function computeSlaDueAt(priority: TicketPriorityKey, from: Date, overrides?: CustomerSlaOverrides | null): Date {
  return new Date(from.getTime() + resolveSlaHours(priority, overrides) * 60 * 60 * 1000);
}

// A ticket's SLA is measured against when it was actually resolved, or
// against now if it's still open - so a ticket resolved in time stays
// "met" forever afterward, rather than a long-since-fixed ticket suddenly
// reading as "breached" because nobody closed it out promptly.
export function isSlaBreached(slaDueAt: Date, resolvedAt: Date | null, now: Date): boolean {
  return (resolvedAt ?? now) > slaDueAt;
}
