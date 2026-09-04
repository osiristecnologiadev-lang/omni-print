// Forecasts when a supply (toner/ink) will run out from its own real
// consumption rate, and flags a replacement that happened with a lot of
// capacity still left ("premature" - matches Printwayy's stated
// "intelligent replenishment predictions" and "premature cartridge
// replacement detection", see roadmap memory Item 3).
//
// A supply's level history isn't purely declining: a replacement/refill
// makes it jump back up. Blending pre- and post-replacement readings into
// one trend would produce nonsense (the old cartridge emptying plus the new
// one starting full looks like almost no net consumption). So this finds
// the most recent jump-up first and only trends the segment after it - the
// same "don't blend across a discontinuity" principle as the page-counter
// reset handling in counter.util.ts, just for a level that's expected to
// jump up sometimes instead of one that should only ever go up.

export interface SupplyReading {
  collectedAt: Date;
  percent: number;
}

export interface SupplyForecast {
  currentPercent: number;
  // %/day while declining; null when there's not enough same-cartridge
  // data yet, or the level isn't declining (idle device, bad data).
  dailyConsumptionPercent: number | null;
  daysRemaining: number | null;
  estimatedEmptyDate: string | null; // ISO date
  likelyEmptyAlready: boolean;
  replacement: { leftoverPercent: number; at: Date } | null;
  premature: boolean;
}

// A hop of at least this many percentage points is a replacement, not
// noise - real consumption only ever declines a few % between polls, so a
// jump this size can only be a fresh cartridge/refill.
const REPLACEMENT_JUMP_THRESHOLD = 15;
// Replaced with more than this % still left is flagged "premature" - a
// judgment call, not a hard rule the way REPLACEMENT_JUMP_THRESHOLD is;
// revisit if real fleets show this needs tuning per vendor.
const PREMATURE_LEFTOVER_THRESHOLD = 15;
// Below this much real elapsed time in the trend segment, don't trust the
// rate enough to forecast at all - see the comment where this is used.
const MIN_SPAN_DAYS = 2;

export function forecastSupply(readings: SupplyReading[], now: Date): SupplyForecast {
  const sorted = [...readings].sort((a, b) => a.collectedAt.getTime() - b.collectedAt.getTime());
  const current = sorted[sorted.length - 1];

  let segmentStart = 0;
  let replacement: { leftoverPercent: number; at: Date } | null = null;
  for (let i = sorted.length - 1; i > 0; i--) {
    if (sorted[i].percent - sorted[i - 1].percent >= REPLACEMENT_JUMP_THRESHOLD) {
      segmentStart = i;
      replacement = { leftoverPercent: sorted[i - 1].percent, at: sorted[i].collectedAt };
      break;
    }
  }

  const segment = sorted.slice(segmentStart);
  let dailyConsumptionPercent: number | null = null;
  let daysRemaining: number | null = null;
  let estimatedEmptyDate: string | null = null;
  let likelyEmptyAlready = false;

  if (segment.length >= 2) {
    const first = segment[0];
    const last = segment[segment.length - 1];
    const daySpan = (last.collectedAt.getTime() - first.collectedAt.getTime()) / 86_400_000;
    // Endpoint-to-endpoint average rate over the segment, not a full
    // regression - noisy middle readings don't change "how much lower is it
    // now than when this cartridge started," and this stays easy to verify
    // by hand (same reasoning as the hop-based counter-reset math).
    //
    // MIN_SPAN_DAYS guards against extrapolating from a few hours of data -
    // confirmed for real against this project's own live-testing metrics: a
    // few hours of one afternoon's bursty test printing produced a rate that,
    // extrapolated to %/day, claimed a cartridge was already empty when it
    // had been sitting at ~20% for weeks. A short burst isn't a daily rate.
    if (daySpan >= MIN_SPAN_DAYS) {
      const rate = (first.percent - last.percent) / daySpan; // %/day; positive means declining
      if (rate > 0.01) {
        dailyConsumptionPercent = rate;
        const daysFromLastReading = last.percent / rate;
        const elapsedSinceLastReading = (now.getTime() - last.collectedAt.getTime()) / 86_400_000;
        const remaining = daysFromLastReading - elapsedSinceLastReading;
        daysRemaining = Math.max(0, Math.round(remaining));
        likelyEmptyAlready = remaining <= 0;
        estimatedEmptyDate = new Date(last.collectedAt.getTime() + daysFromLastReading * 86_400_000)
          .toISOString()
          .slice(0, 10);
      }
    }
  }

  return {
    currentPercent: Math.round(current.percent),
    dailyConsumptionPercent: dailyConsumptionPercent != null ? Math.round(dailyConsumptionPercent * 10) / 10 : null,
    daysRemaining,
    estimatedEmptyDate,
    likelyEmptyAlready,
    replacement,
    premature: !!replacement && replacement.leftoverPercent > PREMATURE_LEFTOVER_THRESHOLD,
  };
}
