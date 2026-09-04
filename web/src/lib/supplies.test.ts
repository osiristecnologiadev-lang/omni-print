import { describe, expect, it } from 'vitest';
import { lowestSupplyPercent } from './api';
import type { Metric } from './api';

function metric(supplies: Metric['supplies']): Metric {
  return {
    id: 'm1',
    deviceId: 'd1',
    collectedAt: '2026-09-01T00:00:00Z',
    online: true,
    sysDescr: null,
    sysName: null,
    sysLocation: null,
    sysContact: null,
    uptimeTicks: null,
    consoleDisplay: null,
    printerStatusCode: null,
    printerStatus: null,
    deviceStatusCode: null,
    deviceStatus: null,
    errorState: null,
    pageCount: null,
    powerOnCount: null,
    supplies,
    inputTrays: null,
    alerts: null,
  } as Metric;
}

describe('lowestSupplyPercent', () => {
  it('returns null for a null metric', () => {
    expect(lowestSupplyPercent(null)).toBeNull();
  });

  it('returns null when supplies is null', () => {
    expect(lowestSupplyPercent(metric(null))).toBeNull();
  });

  it('returns the lowest percent among supply-class items', () => {
    const m = metric([
      { description: 'Cyan', class: 'supply', level: 80, max_level: 100 },
      { description: 'Black', class: 'supply', level: 15, max_level: 100 },
      { description: 'Magenta', class: 'supply', level: 60, max_level: 100 },
    ]);
    expect(lowestSupplyPercent(m)).toBe(15);
  });

  it('ignores non-supply-class items (e.g. a waste receptacle)', () => {
    const m = metric([
      { description: 'Waste box', class: 'receptacle', level: 1, max_level: 100 },
      { description: 'Black', class: 'supply', level: 70, max_level: 100 },
    ]);
    expect(lowestSupplyPercent(m)).toBe(70);
  });

  it('ignores items with max_level <= 0 (avoids a divide-by-zero/garbage percent)', () => {
    const m = metric([
      { description: 'Unknown capacity', class: 'supply', level: 5, max_level: 0 },
      { description: 'Black', class: 'supply', level: 40, max_level: 100 },
    ]);
    expect(lowestSupplyPercent(m)).toBe(40);
  });

  it('returns null when every supply is filtered out', () => {
    const m = metric([{ description: 'Waste box', class: 'receptacle', level: 1, max_level: 100 }]);
    expect(lowestSupplyPercent(m)).toBeNull();
  });

  it('computes a real fractional percent, not just whole-number levels', () => {
    const m = metric([{ description: 'Black', class: 'supply', level: 33, max_level: 200 }]);
    expect(lowestSupplyPercent(m)).toBeCloseTo(16.5);
  });
});
