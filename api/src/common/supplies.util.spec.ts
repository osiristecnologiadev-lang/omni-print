import { lowestSupplyPercent } from './supplies.util';

describe('lowestSupplyPercent', () => {
  it('returns the lowest percent among class "supply" items', () => {
    const supplies = [
      { class: 'supply', level: 80, max_level: 100 },
      { class: 'supply', level: 20, max_level: 100 },
      { class: 'supply', level: 50, max_level: 100 },
    ];
    expect(lowestSupplyPercent(supplies)).toBe(20);
  });

  it('ignores non-"supply" class items (e.g. roller/fuser life counters)', () => {
    const supplies = [
      { class: 'other', level: 1, max_level: 100 }, // would be 1% but isn't a real consumable
      { class: 'supply', level: 60, max_level: 100 },
    ];
    expect(lowestSupplyPercent(supplies)).toBe(60);
  });

  it('ignores items with a zero or missing max_level (division-by-zero guard)', () => {
    const supplies = [{ class: 'supply', level: 0, max_level: 0 }];
    expect(lowestSupplyPercent(supplies)).toBeNull();
  });

  it('returns null for non-array input', () => {
    expect(lowestSupplyPercent(null)).toBeNull();
    expect(lowestSupplyPercent(undefined)).toBeNull();
    expect(lowestSupplyPercent('not an array')).toBeNull();
  });

  it('returns null when there are no supply-class items at all', () => {
    expect(lowestSupplyPercent([{ class: 'other', level: 5, max_level: 100 }])).toBeNull();
  });
});
