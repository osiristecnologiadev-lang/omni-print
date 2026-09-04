import { forecastSupply, type SupplyReading } from './supply-forecast.util';

function day(daysAgo: number, now: Date): Date {
  return new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000);
}

describe('forecastSupply', () => {
  it('forecasts a normal decline with no replacement', () => {
    const now = new Date('2026-09-03T12:00:00Z');
    const readings: SupplyReading[] = [
      { collectedAt: day(6, now), percent: 90 },
      { collectedAt: day(0, now), percent: 40 },
    ];
    const forecast = forecastSupply(readings, now);
    expect(forecast.currentPercent).toBe(40);
    expect(forecast.dailyConsumptionPercent).toBeCloseTo((90 - 40) / 6, 1);
    expect(forecast.daysRemaining).toBe(Math.round(40 / ((90 - 40) / 6)));
    expect(forecast.replacement).toBeNull();
    expect(forecast.premature).toBe(false);
  });

  it('regression: refuses to forecast from a span shorter than MIN_SPAN_DAYS, even with a real declining rate', () => {
    // Real bug caught this session: real devices with only a few hours of
    // one afternoon's live-testing data produced "already out of toner!"
    // forecasts, extrapolated from a real but tiny window. A cartridge
    // sitting at 19% for weeks looked "empty" from a 5-hour burst of test
    // printing. This must come back as "no forecast," not a guess.
    const now = new Date('2026-09-01T21:50:00Z');
    const readings: SupplyReading[] = [
      { collectedAt: new Date('2026-09-01T16:54:00Z'), percent: 22 },
      { collectedAt: new Date('2026-09-01T21:50:00Z'), percent: 19 },
    ];
    const forecast = forecastSupply(readings, now);
    expect(forecast.dailyConsumptionPercent).toBeNull();
    expect(forecast.daysRemaining).toBeNull();
    expect(forecast.estimatedEmptyDate).toBeNull();
    expect(forecast.currentPercent).toBe(19); // still reports the real current level, just no projection
  });

  it('only trends the segment after the most recent replacement, not blended with the old cartridge', () => {
    const now = new Date('2026-09-03T12:00:00Z');
    const readings: SupplyReading[] = [
      { collectedAt: day(12, now), percent: 90 },
      { collectedAt: day(10, now), percent: 60 }, // old cartridge nearly out
      { collectedAt: day(9.9, now), percent: 100 }, // replaced
      { collectedAt: day(6, now), percent: 70 },
      { collectedAt: day(0, now), percent: 40 },
    ];
    const forecast = forecastSupply(readings, now);
    // Trend should only span the 100 -> 40 segment (~9.9 days), not
    // include the pre-replacement 90/60 readings.
    const expectedRate = (100 - 40) / 9.9;
    expect(forecast.dailyConsumptionPercent).toBeCloseTo(expectedRate, 1);
    expect(forecast.replacement?.leftoverPercent).toBe(60);
  });

  it('flags a replacement as premature when a lot of capacity was left', () => {
    const now = new Date('2026-09-03T12:00:00Z');
    const readings: SupplyReading[] = [
      { collectedAt: day(8, now), percent: 60 },
      { collectedAt: day(7.9, now), percent: 100 }, // replaced with 60% still left
      { collectedAt: day(0, now), percent: 40 },
    ];
    const forecast = forecastSupply(readings, now);
    expect(forecast.premature).toBe(true);
    expect(forecast.replacement?.leftoverPercent).toBe(60);
  });

  it('does not flag a replacement as premature when the old cartridge was nearly empty', () => {
    const now = new Date('2026-09-03T12:00:00Z');
    const readings: SupplyReading[] = [
      { collectedAt: day(8, now), percent: 5 },
      { collectedAt: day(7.9, now), percent: 100 }, // replaced near-empty
      { collectedAt: day(0, now), percent: 90 },
    ];
    const forecast = forecastSupply(readings, now);
    expect(forecast.premature).toBe(false);
    expect(forecast.replacement?.leftoverPercent).toBe(5);
  });

  it('flags likelyEmptyAlready once the projected exhaustion date is well in the past', () => {
    const lastReading = new Date('2026-09-03T12:00:00Z');
    const now = new Date('2026-09-15T12:00:00Z'); // 12 days after the last reading, well past the ~7-day projection
    const readings: SupplyReading[] = [
      { collectedAt: day(9, lastReading), percent: 90 },
      { collectedAt: lastReading, percent: 40 },
    ];
    const forecast = forecastSupply(readings, now);
    expect(forecast.likelyEmptyAlready).toBe(true);
    expect(forecast.daysRemaining).toBe(0);
  });
});
