import type { LatestMetric, Metric } from './api';

// A single-reading "how many pages does this device show right now" figure
// - same preference as the API's billing math (ContractsService.pagesInPeriod):
// the vendor's own "pages actually printed" counter when the device reports
// one, the engine/mechanism counter (page_count) otherwise. See
// Collector.collectMarkerSplit's comment for why these can differ a lot on
// the same device - use this instead of reading page_count/pageCount
// directly wherever a single current-total figure is shown.
//
// Deliberately its own module, not part of lib/api.ts: api.ts imports
// next/headers at module scope (server-only), and this needs to be
// importable from client components like DeviceFleetTable's search/filter
// UI - importing a value from api.ts there would pull the whole module,
// next/headers included, into the client bundle and break the build.
export function displayPageCount(metric: LatestMetric | Metric | null): number | null {
  if (!metric) return null;
  const mono = 'page_count' in metric ? metric.mono_page_count : metric.monoPageCount;
  const color = 'page_count' in metric ? metric.color_page_count : metric.colorPageCount;
  if (mono != null && color != null) {
    return Number(mono) + Number(color);
  }
  const engine = 'page_count' in metric ? metric.page_count : metric.pageCount;
  return engine != null ? Number(engine) : null;
}

// The device's own lifetime engine/mechanism counter specifically (not the
// preferred display value above) - shown as supplementary info alongside
// displayPageCount()'s result, matching the same "extra info" the API's
// billing rows expose as enginePages.
export function engineDisplayPageCount(metric: LatestMetric | Metric | null): number | null {
  if (!metric) return null;
  const engine = 'page_count' in metric ? metric.page_count : metric.pageCount;
  return engine != null ? Number(engine) : null;
}
