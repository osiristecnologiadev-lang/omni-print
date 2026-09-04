// Shared helpers for turning a raw sequence of monotonic-ish counter
// readings (page counts, meter readings) into real usage numbers - used by
// ContractsService (monthly billing) and DevicesService (daily trend
// charts). Split out once a second consumer needed the exact same
// reset-vs-glitch handling rather than risking a subtly different
// reimplementation.

// A lone reading (or short run of readings) that dips below the level
// already established and then recovers back to at least that level within
// the same period is a transient read glitch - a timeout, a dropped SNMP
// packet, a momentary network hiccup - not a real counter reset. A real
// reset stays low: nothing after it climbs back to where the counter was
// before, at least not within the same period. Confirmed against real
// captured data from this project's own test devices (see
// ContractsService.pagesInPeriod's git history) before trusting this in
// production billing math.
//
// Generic over T so a caller can carry a date/id alongside each reading
// (see bucketDeltas) without a separate re-association pass afterward -
// re-matching filtered values back to their source by value alone breaks
// silently whenever two readings are equal (e.g. an idle weekend).
export function filterTransientDropoutsBy<T>(items: T[], getValue: (item: T) => number): T[] {
  if (items.length === 0) {
    return items;
  }
  const result: T[] = [items[0]];
  let i = 1;
  while (i < items.length) {
    const lastKept = getValue(result[result.length - 1]);
    const cur = getValue(items[i]);
    if (cur < lastKept) {
      let j = i;
      while (j < items.length && getValue(items[j]) < lastKept) {
        j++;
      }
      if (j < items.length) {
        // Recovered at or above the pre-dip level - the whole [i, j) run
        // was noise, skip it as if those polls never happened.
        i = j;
        continue;
      }
      // Never recovers before the data runs out - nothing left to confirm
      // it was a glitch, so trust it as a real (possibly still-ongoing)
      // reset and let the caller account for it normally.
    }
    result.push(items[i]);
    i++;
  }
  return result;
}

export function filterTransientDropouts(readings: number[]): number[] {
  return filterTransientDropoutsBy(readings, (x) => x);
}

// Sums consecutive deltas across an ordered sequence of counter readings.
// A normal (non-decreasing) hop adds its delta as usual; a hop where the
// reading dropped is treated as a counter reset - the device restarted
// counting from 0, so whatever it reads now is exactly what's been printed
// since the reset, and that reading itself is what gets added (not a
// negative number, and not silently clamped to zero either).
export function sumWithResetHandling(readings: number[]): { total: number; reset: boolean } {
  let total = 0;
  let reset = false;
  for (let i = 1; i < readings.length; i++) {
    const delta = readings[i] - readings[i - 1];
    if (delta >= 0) {
      total += delta;
    } else {
      total += readings[i];
      reset = true;
    }
  }
  return { total, reset };
}

// Per-bucket deltas (e.g. one point per day) rather than a single running
// total - for trend charts, where "how much on this specific day" matters,
// not just the period's grand total. Same reset-safe filtering as
// sumWithResetHandling, applied hop by hop instead of accumulated. The
// first bucket is dropped from the output - it's the anchor the first
// delta is computed against, not a delta itself.
export function bucketDeltas<T extends { value: number }>(buckets: T[]): Array<T & { delta: number }> {
  const kept = filterTransientDropoutsBy(buckets, (b) => b.value);
  const result: Array<T & { delta: number }> = [];
  for (let i = 1; i < kept.length; i++) {
    const delta = kept[i].value - kept[i - 1].value;
    result.push({ ...kept[i], delta: delta >= 0 ? delta : kept[i].value });
  }
  return result;
}
