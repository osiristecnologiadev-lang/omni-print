import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { filterTransientDropouts, filterTransientDropoutsBy, sumWithResetHandling } from './counter.util';

export interface PagesInPeriodResult {
  pages: number;
  monoPages: number;
  colorPages: number;
  startReading: number | null;
  endReading: number | null;
  counterReset: boolean;
  usedManualBaseline: boolean;
  // The device's own lifetime engine/mechanism counter (prtMarkerLifeCount)
  // - shown as supplementary info alongside `pages` above, which prefers
  // the vendor's "pages actually printed" counter when available (see this
  // method's body). Always computed, even when `pages` came from a
  // different source entirely.
  enginePages: number;
  engineStartReading: number | null;
  engineEndReading: number | null;
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

    let sequence: Array<{ collectedAt: Date; pageCount: bigint | null; monoPageCount?: bigint | null; colorPageCount?: bigint | null }> =
      [...(baseline ? [baseline] : []), ...inPeriod];

    // A manually-entered "as of this date, the counter read this" reading -
    // see Device.manualBaselineDate's schema comment. Only steps in when
    // there's no real metric before periodStart at all (`baseline` above is
    // null) - that's the one gap it exists to plug. Once a real reading
    // exists before periodStart (any later period, once monitoring has been
    // running a while), the real data always wins and the manual entry is
    // ignored entirely for that period - it must NOT get spliced in ahead
    // of a real baseline just because it's chronologically earlier, or
    // every later period would re-walk the same delta an earlier period
    // (and its already-generated invoice) already billed, double-counting
    // every page from the manual date forward. Also ignored if it's dated
    // after the first in-period reading (would be out of order) or after
    // this period ends (not relevant to it).
    const earliestInPeriod = inPeriod[0]?.collectedAt ?? null;
    const usedManualBaseline =
      baseline == null &&
      device.manualBaselineDate != null &&
      device.manualBaselinePageCount != null &&
      device.manualBaselineDate <= end &&
      (earliestInPeriod == null || device.manualBaselineDate < earliestInPeriod);
    if (usedManualBaseline) {
      sequence = [
        { collectedAt: device.manualBaselineDate!, pageCount: device.manualBaselinePageCount },
        ...sequence,
      ];
    }

    const readings = sequence.filter((m) => m.pageCount != null);
    if (readings.length === 0) {
      return {
        pages: 0,
        monoPages: 0,
        colorPages: 0,
        startReading: null,
        endReading: null,
        counterReset: false,
        usedManualBaseline: false,
        usedFallbackForReset: false,
        enginePages: 0,
        engineStartReading: null,
        engineEndReading: null,
      };
    }

    // The device's own lifetime engine/mechanism counter (prtMarkerLifeCount)
    // - every physical engine cycle, not just print jobs (cleaning,
    // calibration, internal test pages...). Never resets except a genuine
    // hardware event, so this always gets computed as the fallback/reference
    // series below, and returned on its own as supplementary info even when
    // `pages` ends up coming from somewhere else.
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
    const pageCounts = filterTransientDropouts(readings.map((m) => Number(m.pageCount)));
    const { total: enginePages, reset: engineReset } = sumWithResetHandling(pageCounts);
    const engineStartReading = pageCounts[0];
    const engineEndReading = pageCounts[pageCounts.length - 1];

    // The vendor's own "pages actually printed" counter (see
    // Collector.collectMarkerSplit's comment) - a genuinely different, and
    // for billing purposes more accurate, number than the engine count
    // above: confirmed 2026-09-09 against a real device's own web page,
    // 6,119 "printed" vs 75,222 "mechanism" on the same unit. Preferred as
    // the billed/displayed `pages` whenever it's available; only readings
    // with BOTH a mono and color value are usable at all (a poll that
    // returned neither, e.g. a non-HP device, can't contribute).
    const splitReadings = readings
      .filter((m) => m.monoPageCount != null && m.colorPageCount != null)
      .map((m) => ({
        mono: Number(m.monoPageCount),
        color: Number(m.colorPageCount),
        combined: Number(m.monoPageCount) + Number(m.colorPageCount),
        engine: Number(m.pageCount),
      }));

    let pages = enginePages;
    let monoPages = enginePages;
    let colorPages = 0;
    let counterReset = engineReset;
    let usedFallbackForReset = false;
    let splitStartReading: number | null = null;
    let splitEndReading: number | null = null;

    if (splitReadings.length >= 2) {
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
      counterReset,
      usedManualBaseline,
      enginePages,
      engineStartReading,
      engineEndReading,
      usedFallbackForReset,
    };
  }
}
