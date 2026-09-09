import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { filterTransientDropoutsBy, sumWithResetHandling } from './counter.util';

export interface PagesInPeriodResult {
  pages: number;
  monoPages: number;
  colorPages: number;
  startReading: number | null;
  endReading: number | null;
  // When each figure above actually starts/ends counting from - NOT always
  // periodStart/periodEnd. `pages`' own start can be the manual baseline
  // date (earlier than periodStart) or a device's first-ever real reading
  // (later than periodStart, if monitoring started mid-period) - showing
  // these dates is what actually explains why `pages` and `enginePages`
  // below can cover different windows and so aren't directly comparable.
  startReadingAt: string | null;
  endReadingAt: string | null;
  counterReset: boolean;
  usedManualBaseline: boolean;
  // The device's own lifetime engine/mechanism counter (prtMarkerLifeCount)
  // - shown as supplementary info alongside `pages` above, which prefers
  // the vendor's "pages actually printed" counter when available (see this
  // method's body). Always computed, even when `pages` came from a
  // different source entirely. Its own start/end dates are tracked
  // separately (engineStartReadingAt/engineEndReadingAt) since the manual
  // baseline only ever anchors ONE of the two pipelines (see
  // manualBaselineValid's comment) - this one's window is often shorter,
  // starting from the device's first real reading instead.
  enginePages: number;
  engineStartReading: number | null;
  engineEndReading: number | null;
  engineStartReadingAt: string | null;
  engineEndReadingAt: string | null;
  // True when at least one hop this period had the "printed" counter
  // reset and got bridged using the engine counter's own delta for that
  // hop instead - see the fallback loop in this method's body.
  usedFallbackForReset: boolean;
}

// Shared between ContractsService (billing, needs a contract) and
// DevicesService (a device's own "pages so far this period" info, doesn't
// need one) - split out once the second consumer needed the exact same
// reset/fallback/manual-baseline/printed-vs-engine-counter logic, rather
// than risking a subtly different reimplementation (same reasoning as
// counter.util.ts's own pure helpers).
@Injectable()
export class DevicePagesService {
  constructor(private readonly prisma: PrismaService) {}

  async pagesInPeriod(
    device: { id: string; manualBaselineDate: Date | null; manualBaselinePageCount: bigint | null },
    start: Date,
    end: Date,
  ): Promise<PagesInPeriodResult> {
    const deviceId = device.id;
    const [baseline, inPeriod] = await Promise.all([
      this.prisma.metric.findFirst({
        where: { deviceId, collectedAt: { lte: start } },
        orderBy: { collectedAt: 'desc' },
      }),
      this.prisma.metric.findMany({
        where: { deviceId, collectedAt: { gt: start, lte: end } },
        orderBy: { collectedAt: 'asc' },
      }),
    ]);

    const sequence: Array<{ collectedAt: Date; pageCount: bigint | null; monoPageCount?: bigint | null; colorPageCount?: bigint | null }> =
      [...(baseline ? [baseline] : []), ...inPeriod];

    const readings = sequence.filter((m) => m.pageCount != null);

    // The vendor's own "pages actually printed" counter (see
    // Collector.collectMarkerSplit's comment) - genuinely different from,
    // and for billing purposes more accurate than, the engine count below:
    // confirmed 2026-09-09 against a real device's own web page, 6,119
    // "printed" vs 75,222 "mechanism" on the same unit. Only readings with
    // BOTH a mono and color value are usable (a poll that returned neither,
    // e.g. a non-HP device, can't contribute).
    const realSplitReadings = readings
      .filter((m) => m.monoPageCount != null && m.colorPageCount != null)
      .map((m) => ({
        collectedAt: m.collectedAt,
        mono: Number(m.monoPageCount),
        color: Number(m.colorPageCount),
        combined: Number(m.monoPageCount) + Number(m.colorPageCount),
        engine: Number(m.pageCount),
        isManual: false as const,
      }));

    // A manually-entered "as of this date, the counter read this" reading -
    // see Device.manualBaselineDate's schema comment. Represents the SAME
    // concept `pages` normally reports - the printed-pages counter when the
    // device supports it, the engine counter otherwise - NOT hardcoded to
    // either: a real device's printed and engine totals can differ by an
    // order of magnitude (see the comment above), so a baseline meant as
    // "6,064 pages printed" would silently corrupt the engine pipeline if
    // spliced in there (found for real: a device reporting 75,222 engine
    // pages showed an "impossible" 69,163-page month once a 6,064 printed-
    // pages baseline got treated as an engine reading). So this only ever
    // joins whichever pipeline actually ends up producing `pages` below,
    // never both at once.
    //
    // Only steps in when there's no real metric before periodStart at all
    // (`baseline` above is null) - that's the one gap it exists to plug.
    // Once ANY real reading exists before periodStart (any later period,
    // once monitoring has been running a while), real data always wins and
    // the manual entry is ignored entirely for that period - it must NOT
    // get spliced in ahead of a real baseline just because it's
    // chronologically earlier, or every later period would re-walk the
    // same delta an earlier period (and its already-generated invoice)
    // already billed, double-counting every page from the manual date
    // forward. Checking against `baseline` specifically (not just "earlier
    // than the first split/engine reading in this call") matters: a device
    // can have real pre-period engine data but no real pre-period *split*
    // data (e.g. the agent only started reporting the split OID recently) -
    // `baseline` existing at all means the gap is already closed, for
    // either pipeline, regardless of which fields that one reading has.
    const manualBaselineValid =
      baseline == null &&
      device.manualBaselineDate != null &&
      device.manualBaselinePageCount != null &&
      device.manualBaselineDate <= end;
    const manualHelpsSplit =
      manualBaselineValid &&
      (realSplitReadings.length === 0 || device.manualBaselineDate! < realSplitReadings[0].collectedAt);
    const useSplitPipeline = realSplitReadings.length + (manualHelpsSplit ? 1 : 0) >= 2;

    let pages = 0;
    let monoPages = 0;
    let colorPages = 0;
    let counterReset = false;
    let usedFallbackForReset = false;
    let usedManualBaseline = false;
    let splitStartReading: number | null = null;
    let splitEndReading: number | null = null;
    let splitStartReadingAt: Date | null = null;
    let splitEndReadingAt: Date | null = null;

    if (useSplitPipeline) {
      const splitReadings = manualHelpsSplit
        ? [
            {
              collectedAt: device.manualBaselineDate!,
              mono: Number(device.manualBaselinePageCount),
              color: 0,
              combined: Number(device.manualBaselinePageCount),
              engine: 0, // unused - see isManual handling in the loop below
              isManual: true as const,
            },
            ...realSplitReadings,
          ]
        : realSplitReadings;
      usedManualBaseline = manualHelpsSplit;

      // Same noise-vs-real-reset filtering as the engine series, applied to
      // the combined (mono+color) total this time.
      const filtered = filterTransientDropoutsBy(splitReadings, (r) => r.combined);
      let total = 0;
      let mono = 0;
      let color = 0;
      let reset = false;
      let usedFallback = false;
      for (let i = 1; i < filtered.length; i++) {
        const combinedDelta = filtered[i].combined - filtered[i - 1].combined;
        if (combinedDelta >= 0) {
          total += combinedDelta;
          mono += filtered[i].mono - filtered[i - 1].mono;
          color += filtered[i].color - filtered[i - 1].color;
          continue;
        }
        if (filtered[i - 1].isManual) {
          // No real engine reading exists to cross-check a hop anchored on
          // the manual baseline against (that baseline has no engine
          // counterpart at all) - trust the first real reading directly,
          // same rule as an ordinary reset.
          total += filtered[i].combined;
          mono += filtered[i].mono;
          color += filtered[i].color;
          reset = true;
          continue;
        }
        // The "printed" counter dropped this hop - a reset of THAT counter
        // specifically (e.g. a technician resetting it), not necessarily the
        // device itself. Cross-check against the engine counter, which
        // shouldn't have reset at the same moment, and use its delta for
        // just this one hop instead of losing the pages printed right
        // around the reset - see sumWithFallbackOnReset's comment for the
        // full reasoning (this loop is the same algorithm, inlined so the
        // mono/color attribution can happen alongside it).
        const engineDelta = filtered[i].engine - filtered[i - 1].engine;
        if (engineDelta >= 0) {
          total += engineDelta;
          mono += engineDelta; // can't know the real split for a substituted hop - same safe-default as an unsplittable hop elsewhere in this method
          usedFallback = true;
        } else {
          // Both counters dropped together - a genuine whole-device reset,
          // not just the printed-pages counter. Trust each post-reset
          // reading directly, same rule as sumWithResetHandling.
          total += filtered[i].combined;
          mono += filtered[i].mono;
          color += filtered[i].color;
          reset = true;
        }
      }
      pages = total;
      monoPages = mono;
      colorPages = color;
      counterReset = reset || usedFallback;
      usedFallbackForReset = usedFallback;
      splitStartReading = filtered[0].combined;
      splitEndReading = filtered[filtered.length - 1].combined;
      splitStartReadingAt = filtered[0].collectedAt;
      splitEndReadingAt = filtered[filtered.length - 1].collectedAt;
    }

    // The device's own lifetime engine/mechanism counter (prtMarkerLifeCount)
    // - every physical engine cycle, not just print jobs (cleaning,
    // calibration, internal test pages...). Never resets except a genuine
    // hardware event. Always computed and returned as supplementary info
    // even when `pages` came from the split pipeline above - the manual
    // baseline is only added here when it ISN'T already anchoring the split
    // pipeline (see the comment on manualBaselineValid above for why never
    // both).
    //
    // Filter transient read glitches before looking for real resets - see
    // filterTransientDropouts's comment. Caught for real against this
    // project's own live test data: two real devices each had a lone poll
    // (sometimes two in a row) read back 0 mid-sequence and then recovered
    // to their previous magnitude a poll or two later - almost certainly a
    // transient SNMP/network hiccup during earlier real-hardware testing
    // (see [[feedback-omniprint-approach]] on validating against real
    // hardware - this is exactly the kind of noise that only shows up
    // there), not a real reset. Treating it as one inflated a real
    // customer's page count from 1,339 to 586,471 the first time this was
    // tried without the filter - a MUCH worse failure mode than the
    // original undercounting bug, since it silently overbills instead of
    // undercounting. A genuine reset (this project's own synthetic test:
    // 1000 → 1500 → 50 → 300 → 300) still passes through correctly because
    // the low reading doesn't recover within the period.
    let engineSequence = readings.map((m) => ({ collectedAt: m.collectedAt, value: Number(m.pageCount) }));
    const manualHelpsEngine =
      !useSplitPipeline &&
      manualBaselineValid &&
      (engineSequence.length === 0 || device.manualBaselineDate! < engineSequence[0].collectedAt);
    if (manualHelpsEngine) {
      engineSequence = [
        { collectedAt: device.manualBaselineDate!, value: Number(device.manualBaselinePageCount) },
        ...engineSequence,
      ];
      usedManualBaseline = true;
    }
    const filteredEngine = filterTransientDropoutsBy(engineSequence, (r) => r.value);
    const pageCounts = filteredEngine.map((r) => r.value);
    const { total: enginePages, reset: engineReset } = sumWithResetHandling(pageCounts);
    const engineStartReading = pageCounts[0] ?? null;
    const engineEndReading = pageCounts[pageCounts.length - 1] ?? null;
    const engineStartReadingAt = filteredEngine[0]?.collectedAt ?? null;
    const engineEndReadingAt = filteredEngine[filteredEngine.length - 1]?.collectedAt ?? null;

    if (!useSplitPipeline) {
      pages = enginePages;
      monoPages = enginePages;
      colorPages = 0;
      counterReset = engineReset;
    }

    return {
      pages,
      monoPages,
      colorPages,
      // Shown on the invoice as "leitura anterior/atual" - whichever series
      // actually produced `pages` above, so the two numbers always
      // arithmetically agree (a mix of the two would otherwise contradict
      // the total).
      startReading: splitStartReading ?? engineStartReading,
      endReading: splitEndReading ?? engineEndReading,
      startReadingAt: (splitStartReadingAt ?? engineStartReadingAt)?.toISOString() ?? null,
      endReadingAt: (splitEndReadingAt ?? engineEndReadingAt)?.toISOString() ?? null,
      counterReset,
      usedManualBaseline,
      enginePages,
      engineStartReading,
      engineEndReading,
      engineStartReadingAt: engineStartReadingAt?.toISOString() ?? null,
      engineEndReadingAt: engineEndReadingAt?.toISOString() ?? null,
      usedFallbackForReset,
    };
  }
}
