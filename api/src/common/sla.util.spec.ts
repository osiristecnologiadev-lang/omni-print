import { computeSlaDueAt, isSlaBreached, resolveSlaHours, SLA_HOURS_BY_PRIORITY } from './sla.util';

describe('computeSlaDueAt', () => {
  it('adds the right number of hours for each priority', () => {
    const from = new Date('2026-09-01T00:00:00Z');
    expect(computeSlaDueAt('URGENT', from)).toEqual(new Date('2026-09-01T04:00:00Z'));
    expect(computeSlaDueAt('HIGH', from)).toEqual(new Date('2026-09-02T00:00:00Z'));
    expect(computeSlaDueAt('MEDIUM', from)).toEqual(new Date('2026-09-03T00:00:00Z'));
    expect(computeSlaDueAt('LOW', from)).toEqual(new Date('2026-09-04T00:00:00Z'));
  });

  it('every priority has a positive threshold', () => {
    for (const hours of Object.values(SLA_HOURS_BY_PRIORITY)) {
      expect(hours).toBeGreaterThan(0);
    }
  });

  it('a customer override replaces the global default for that priority', () => {
    const from = new Date('2026-09-01T00:00:00Z');
    expect(computeSlaDueAt('URGENT', from, { slaHoursUrgent: 2 })).toEqual(new Date('2026-09-01T02:00:00Z'));
  });

  it('an override on one priority does not affect the others, which keep the global default', () => {
    const from = new Date('2026-09-01T00:00:00Z');
    expect(computeSlaDueAt('HIGH', from, { slaHoursUrgent: 2 })).toEqual(new Date('2026-09-02T00:00:00Z'));
  });

  it('a null override (explicitly reset) falls back to the global default, not zero hours', () => {
    const from = new Date('2026-09-01T00:00:00Z');
    expect(computeSlaDueAt('URGENT', from, { slaHoursUrgent: null })).toEqual(new Date('2026-09-01T04:00:00Z'));
  });

  it('no overrides object at all falls back to the global defaults', () => {
    const from = new Date('2026-09-01T00:00:00Z');
    expect(computeSlaDueAt('LOW', from)).toEqual(new Date('2026-09-04T00:00:00Z'));
  });
});

describe('resolveSlaHours', () => {
  it('returns the override when set', () => {
    expect(resolveSlaHours('HIGH', { slaHoursHigh: 6 })).toBe(6);
  });

  it('returns the global default when the override is null/undefined/absent', () => {
    expect(resolveSlaHours('HIGH', { slaHoursHigh: null })).toBe(SLA_HOURS_BY_PRIORITY.HIGH);
    expect(resolveSlaHours('HIGH', {})).toBe(SLA_HOURS_BY_PRIORITY.HIGH);
    expect(resolveSlaHours('HIGH')).toBe(SLA_HOURS_BY_PRIORITY.HIGH);
  });

  it('an override of 0 is a real (if unusual) value, not treated as "unset"', () => {
    expect(resolveSlaHours('URGENT', { slaHoursUrgent: 0 })).toBe(0);
  });
});

describe('isSlaBreached', () => {
  const dueAt = new Date('2026-09-01T12:00:00Z');

  it('an open ticket past its due date, measured against now, is breached', () => {
    const now = new Date('2026-09-01T13:00:00Z');
    expect(isSlaBreached(dueAt, null, now)).toBe(true);
  });

  it('an open ticket still before its due date is not breached', () => {
    const now = new Date('2026-09-01T11:00:00Z');
    expect(isSlaBreached(dueAt, null, now)).toBe(false);
  });

  it('a ticket resolved before the deadline stays "met" even long after, regardless of now', () => {
    const resolvedAt = new Date('2026-09-01T10:00:00Z');
    const now = new Date('2027-01-01T00:00:00Z'); // long after, doesn't matter
    expect(isSlaBreached(dueAt, resolvedAt, now)).toBe(false);
  });

  it('a ticket resolved after the deadline stays "breached" even if checked much later', () => {
    const resolvedAt = new Date('2026-09-01T13:00:00Z');
    const now = new Date('2027-01-01T00:00:00Z');
    expect(isSlaBreached(dueAt, resolvedAt, now)).toBe(true);
  });

  it('resolved at the exact deadline instant is not a breach (strictly after, not at-or-after)', () => {
    expect(isSlaBreached(dueAt, dueAt, dueAt)).toBe(false);
  });
});
