// Mirrors web/src/lib/api.ts's lowestSupplyPercent - lowest fill level among
// actual consumables (class "supply": toner/ink; excludes "other"-class
// items like roller-life counters, which aren't something a fleet manager
// restocks). Metric.supplies is a loosely-typed Prisma Json column, so this
// reads defensively rather than assuming a shape.
export function lowestSupplyPercent(supplies: unknown): number | null {
  if (!Array.isArray(supplies)) {
    return null;
  }
  const percents = supplies
    .filter(
      (s): s is { class: string; level: number; max_level: number } =>
        !!s && typeof s === 'object' && s.class === 'supply' && typeof s.max_level === 'number' && s.max_level > 0,
    )
    .map((s) => (s.level / s.max_level) * 100);
  return percents.length > 0 ? Math.min(...percents) : null;
}
