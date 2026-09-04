import { filterTransientDropouts, sumWithResetHandling, bucketDeltas } from './counter.util';

describe('sumWithResetHandling', () => {
  it('sums a normal non-decreasing sequence as plain deltas', () => {
    const { total, reset } = sumWithResetHandling([1000, 1200, 1450, 1450, 1600]);
    expect(total).toBe(600);
    expect(reset).toBe(false);
  });

  it('treats a sustained drop as a reset and adds the post-reset reading itself', () => {
    // Real scenario validated this session: a genuine counter reset that
    // stays low (unlike a transient glitch) - 1000 -> 1500 (+500),
    // 1500 -> 50 (reset, +50), 50 -> 300 (+250), 300 -> 300 (+0) = 800.
    const { total, reset } = sumWithResetHandling([1000, 1500, 50, 300, 300]);
    expect(total).toBe(800);
    expect(reset).toBe(true);
  });

  it('never returns a negative running total from a reset hop', () => {
    const { total } = sumWithResetHandling([500, 10]);
    expect(total).toBeGreaterThanOrEqual(0);
    expect(total).toBe(10);
  });
});

describe('filterTransientDropouts', () => {
  it('leaves a clean increasing sequence untouched', () => {
    expect(filterTransientDropouts([100, 110, 125])).toEqual([100, 110, 125]);
  });

  it('drops a single-reading glitch that recovers to the prior level', () => {
    // Real data captured this session (device SEC8425196B41D7): a transient
    // SNMP/network hiccup reported 0 once, then recovered - not a reset.
    const readings = [522944, 523031, 0, 523089];
    expect(filterTransientDropouts(readings)).toEqual([522944, 523031, 523089]);
  });

  it('drops a multi-reading glitch run that recovers', () => {
    // Real data captured this session: two consecutive 0 readings before
    // recovering - the filter must skip the whole run, not just one point.
    const readings = [523191, 523245, 0, 0, 523340, 523514, 523587];
    expect(filterTransientDropouts(readings)).toEqual([523191, 523245, 523340, 523514, 523587]);
  });

  it('does NOT drop a genuine reset that never recovers within the data', () => {
    const readings = [1500, 50, 300, 300];
    expect(filterTransientDropouts(readings)).toEqual([1500, 50, 300, 300]);
  });

  it('regression: the real overcounting bug - glitches must not inflate the total', () => {
    // This exact sequence (with the naive reset-detection, pre-filter)
    // inflated a real customer's monthly page total from 1,339 to 586,471 -
    // the filter exists specifically to keep this from happening again.
    const readings = [522944, 523031, 523089, 523150, 523191, 523245, 0, 0, 523340, 523514, 523587];
    const filtered = filterTransientDropouts(readings);
    const { total, reset } = sumWithResetHandling(filtered);
    expect(total).toBe(523587 - 522944); // 643 - the real, correct delta
    expect(reset).toBe(false);
  });
});

describe('bucketDeltas', () => {
  it('emits one delta per bucket after the first (the anchor)', () => {
    const buckets = [
      { date: '2026-08-25', value: 10180 },
      { date: '2026-08-26', value: 10420 },
      { date: '2026-08-27', value: 10510 },
    ];
    expect(bucketDeltas(buckets)).toEqual([
      { date: '2026-08-26', value: 10420, delta: 240 },
      { date: '2026-08-27', value: 10510, delta: 90 },
    ]);
  });

  it('never emits a negative delta - a drop at the very last bucket (no later reading to confirm it as a glitch) is treated as a reset', () => {
    const buckets = [
      { date: '2026-09-01', value: 5 },
      { date: '2026-09-02', value: 100 },
      { date: '2026-09-03', value: 90 }, // drop, but it's the last bucket - nothing after it to prove this was noise
    ];
    expect(bucketDeltas(buckets)).toEqual([
      { date: '2026-09-02', value: 100, delta: 95 },
      { date: '2026-09-03', value: 90, delta: 90 }, // treated as a reset: the reading itself, not -10
    ]);
  });

  it('filters out a same-value plateau correctly (idle weekend, no false reset)', () => {
    const buckets = [
      { date: '2026-08-01', value: 100 },
      { date: '2026-08-02', value: 100 }, // idle - identical reading
      { date: '2026-08-03', value: 120 },
    ];
    expect(bucketDeltas(buckets)).toEqual([
      { date: '2026-08-02', value: 100, delta: 0 },
      { date: '2026-08-03', value: 120, delta: 20 },
    ]);
  });
});
