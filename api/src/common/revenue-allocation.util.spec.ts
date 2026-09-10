import { allocateUsageRevenue } from './revenue-allocation.util';

describe('allocateUsageRevenue', () => {
  it('splits mono and color revenue proportionally by each device\'s own page share', () => {
    const devices = [
      { deviceId: 'a', monoPages: 100, colorPages: 0 },
      { deviceId: 'b', monoPages: 300, colorPages: 200 },
      { deviceId: 'c', monoPages: 0, colorPages: 800 },
    ];
    // totalMono = 400, totalColor = 1000
    const result = allocateUsageRevenue(devices, 40, 100);

    expect(result.get('a')).toBeCloseTo(10); // 100/400 * 40
    expect(result.get('b')).toBeCloseTo(30 + 20); // 300/400*40 + 200/1000*100
    expect(result.get('c')).toBeCloseTo(80); // 800/1000 * 100
  });

  it('sums back exactly to the total revenue, whatever the split', () => {
    const devices = [
      { deviceId: 'a', monoPages: 137, colorPages: 42 },
      { deviceId: 'b', monoPages: 9, colorPages: 908 },
      { deviceId: 'c', monoPages: 501, colorPages: 0 },
    ];
    const result = allocateUsageRevenue(devices, 73.5, 210.25);
    const total = [...result.values()].reduce((sum, v) => sum + v, 0);
    expect(total).toBeCloseTo(73.5 + 210.25);
  });

  it('returns zero revenue for every device when both totals are zero (e.g. FLAT_RATE)', () => {
    const devices = [
      { deviceId: 'a', monoPages: 500, colorPages: 100 },
      { deviceId: 'b', monoPages: 0, colorPages: 0 },
    ];
    const result = allocateUsageRevenue(devices, 0, 0);
    expect(result.get('a')).toBe(0);
    expect(result.get('b')).toBe(0);
  });

  it('splits evenly across devices when a channel has zero total pages but nonzero revenue', () => {
    // A guaranteed-minimum PER_PAGE contract billed before any device has
    // reported real pages this period - there's no usage signal to
    // allocate by, so the only fair fallback is an even split.
    const devices = [
      { deviceId: 'a', monoPages: 0, colorPages: 0 },
      { deviceId: 'b', monoPages: 0, colorPages: 0 },
    ];
    const result = allocateUsageRevenue(devices, 100, 0);
    expect(result.get('a')).toBeCloseTo(50);
    expect(result.get('b')).toBeCloseTo(50);
  });

  it('returns an empty map for no devices, without dividing by zero', () => {
    const result = allocateUsageRevenue([], 100, 50);
    expect(result.size).toBe(0);
  });
});
