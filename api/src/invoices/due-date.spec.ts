import { dueDateFor } from './invoices.service';

describe('dueDateFor', () => {
  it('calendar month: always the following month, clamped to its length', () => {
    expect(dueDateFor(15, new Date('2026-09-30T23:59:59.999Z')).toISOString()).toBe('2026-10-15T23:59:59.999Z');
    expect(dueDateFor(31, new Date('2026-08-31T23:59:59.999Z')).toISOString()).toBe('2026-09-30T23:59:59.999Z');
    expect(dueDateFor(10, new Date('2026-12-31T23:59:59.999Z')).toISOString()).toBe('2027-01-10T23:59:59.999Z');
  });

  it('closing day: the first billingDay after the period, same month when it fits', () => {
    const end = new Date('2026-10-27T23:59:59.999Z'); // day 28 cycle
    expect(dueDateFor(30, end).toISOString()).toBe('2026-10-30T23:59:59.999Z');
    expect(dueDateFor(10, end).toISOString()).toBe('2026-11-10T23:59:59.999Z');
    expect(dueDateFor(27, end).toISOString()).toBe('2026-11-27T23:59:59.999Z');
  });
});
