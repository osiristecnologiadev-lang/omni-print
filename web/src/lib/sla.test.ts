import { describe, expect, it } from 'vitest';
import { isTicketSlaBreached } from './sla';

describe('isTicketSlaBreached', () => {
  const slaDueAt = '2026-09-01T12:00:00Z';

  it('an open ticket past its deadline, measured against now, is breached', () => {
    expect(isTicketSlaBreached({ slaDueAt, resolvedAt: null }, new Date('2026-09-01T13:00:00Z'))).toBe(true);
  });

  it('an open ticket still before its deadline is not breached', () => {
    expect(isTicketSlaBreached({ slaDueAt, resolvedAt: null }, new Date('2026-09-01T11:00:00Z'))).toBe(false);
  });

  it('a ticket resolved before the deadline stays met regardless of how much later it is checked', () => {
    const ticket = { slaDueAt, resolvedAt: '2026-09-01T10:00:00Z' };
    expect(isTicketSlaBreached(ticket, new Date('2027-01-01T00:00:00Z'))).toBe(false);
  });

  it('a ticket resolved after the deadline stays breached regardless of when checked', () => {
    const ticket = { slaDueAt, resolvedAt: '2026-09-01T13:00:00Z' };
    expect(isTicketSlaBreached(ticket, new Date('2027-01-01T00:00:00Z'))).toBe(true);
  });
});
