// A customer's billing cycle ("dia de fechamento"): the day of the month its
// counters are closed. Day 1 is the plain calendar month (01/09 - 30/09).
// Any other day D makes every period run from day D of one month to day
// D-1 of the next (D=28: 28/09 - 27/10, then 28/10 - 27/11), for customers
// who'd rather pay inside the same month the usage was measured.
//
// A period is named by the month its LAST day falls in (its "competência"):
// with D=28, "outubro/2026" is 28/09 - 27/10. With D=1 that's simply the
// calendar month itself, so every (year, month) the app already used keeps
// meaning exactly what it did before for customers that never set a day.
//
// Capped at 28 so every month actually has the day - no clamping rules for
// "day 31 in February" that would make consecutive periods overlap or skip.
// Dates are UTC-anchored, same as the calendar months always were.

export const MIN_BILLING_CYCLE_DAY = 1;
export const MAX_BILLING_CYCLE_DAY = 28;

export interface BillingPeriod {
  periodStart: Date;
  periodEnd: Date; // last instant of the period, inclusive
}

export function cyclePeriod(year: number, month: number, cycleDay = 1): BillingPeriod {
  if (cycleDay <= 1) {
    return {
      periodStart: new Date(Date.UTC(year, month - 1, 1, 0, 0, 0)),
      periodEnd: new Date(Date.UTC(year, month, 0, 23, 59, 59, 999)), // last instant of the month
    };
  }
  return {
    periodStart: new Date(Date.UTC(year, month - 2, cycleDay)),
    periodEnd: new Date(Date.UTC(year, month - 1, cycleDay) - 1),
  };
}

// The competência whose period contains `at`.
export function cycleContaining(at: Date, cycleDay = 1): { year: number; month: number } {
  const year = at.getUTCFullYear();
  const monthIndex = at.getUTCMonth();
  const shifted = cycleDay > 1 && at.getUTCDate() >= cycleDay ? monthIndex + 1 : monthIndex;
  const d = new Date(Date.UTC(year, shifted, 1));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
}

// The most recent competência that has already fully closed at `at`.
export function lastClosedCycle(at: Date, cycleDay = 1): { year: number; month: number } {
  const current = cycleContaining(at, cycleDay);
  const d = new Date(Date.UTC(current.year, current.month - 2, 1));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
}

// The month (as "YYYY-MM-01") a period belongs to - its last day's month,
// which is the competência for any cycle day (see the top comment).
export function competenciaKey(periodEnd: Date): string {
  return new Date(Date.UTC(periodEnd.getUTCFullYear(), periodEnd.getUTCMonth(), 1)).toISOString().slice(0, 10);
}
