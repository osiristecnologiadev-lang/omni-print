import { competenciaKey, cycleContaining, cyclePeriod, lastClosedCycle } from './billing-cycle.util';

describe('cyclePeriod', () => {
  it('day 1 is the plain calendar month', () => {
    const p = cyclePeriod(2026, 2, 1);
    expect(p.periodStart.toISOString()).toBe('2026-02-01T00:00:00.000Z');
    expect(p.periodEnd.toISOString()).toBe('2026-02-28T23:59:59.999Z');
  });

  it('day 28: October is 28/09 - 27/10', () => {
    const p = cyclePeriod(2026, 10, 28);
    expect(p.periodStart.toISOString()).toBe('2026-09-28T00:00:00.000Z');
    expect(p.periodEnd.toISOString()).toBe('2026-10-27T23:59:59.999Z');
  });

  it('crosses the year: January with day 15 is 15/12 - 14/01', () => {
    const p = cyclePeriod(2027, 1, 15);
    expect(p.periodStart.toISOString()).toBe('2026-12-15T00:00:00.000Z');
    expect(p.periodEnd.toISOString()).toBe('2027-01-14T23:59:59.999Z');
  });

  it('consecutive periods touch with no gap or overlap', () => {
    const oct = cyclePeriod(2026, 10, 28);
    const nov = cyclePeriod(2026, 11, 28);
    expect(nov.periodStart.getTime()).toBe(oct.periodEnd.getTime() + 1);
  });
});

describe('cycleContaining / lastClosedCycle', () => {
  it('day 1 follows the calendar', () => {
    expect(cycleContaining(new Date('2026-10-28T10:00:00Z'), 1)).toEqual({ year: 2026, month: 10 });
    expect(lastClosedCycle(new Date('2026-10-01T02:00:00Z'), 1)).toEqual({ year: 2026, month: 9 });
  });

  it('day 28: from the 28th on it is already next month', () => {
    expect(cycleContaining(new Date('2026-10-27T23:00:00Z'), 28)).toEqual({ year: 2026, month: 10 });
    expect(cycleContaining(new Date('2026-10-28T00:00:00Z'), 28)).toEqual({ year: 2026, month: 11 });
    expect(cycleContaining(new Date('2026-12-28T00:00:00Z'), 28)).toEqual({ year: 2027, month: 1 });
    expect(lastClosedCycle(new Date('2026-10-28T02:00:00Z'), 28)).toEqual({ year: 2026, month: 10 });
    expect(lastClosedCycle(new Date('2026-10-27T02:00:00Z'), 28)).toEqual({ year: 2026, month: 9 });
  });
});

describe('competenciaKey', () => {
  it("is the period's last day's month", () => {
    expect(competenciaKey(cyclePeriod(2026, 10, 28).periodEnd)).toBe('2026-10-01');
    expect(competenciaKey(cyclePeriod(2026, 10, 1).periodEnd)).toBe('2026-10-01');
  });
});
