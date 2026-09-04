import { Supply } from '@/lib/api';
import { Badge, type BadgeTone } from './Badge';

function barColor(percent: number): string {
  if (percent < 10) return 'bg-red-500';
  if (percent < 25) return 'bg-amber-500';
  return 'bg-emerald-500';
}

// Renders known colorants with a recognizable swatch; falls back to a
// neutral gray dot for supplies without one (see collector's colorant
// fallback in agent/ - "colorant" is best-effort, not guaranteed).
const COLORANT_SWATCH: Record<string, string> = {
  black: 'bg-ink',
  cyan: 'bg-cyan-500',
  magenta: 'bg-pink-500',
  yellow: 'bg-yellow-400',
};

export interface SupplyForecastSummary {
  daysRemaining: number | null;
  likelyEmptyAlready: boolean;
  premature: boolean;
  leftoverPercent: number | null;
}

// Explicit, not a footnote: the whole point of the forecast (see
// api/src/common/supply-forecast.util.ts) is that the outsource company
// can act on it without opening each device - so it rides right on the
// same row as the level bar, not a muted caption underneath.
function ForecastPill({ forecast }: { forecast: SupplyForecastSummary }) {
  if (forecast.premature) {
    return (
      <Badge tone="info" className="shrink-0">
        trocado c/ {forecast.leftoverPercent}% sobrando
      </Badge>
    );
  }
  if (forecast.likelyEmptyAlready) {
    return (
      <Badge tone="critical" className="shrink-0">
        provavelmente vazio
      </Badge>
    );
  }
  if (forecast.daysRemaining != null) {
    const tone: BadgeTone = forecast.daysRemaining <= 7 ? 'critical' : forecast.daysRemaining <= 14 ? 'warning' : 'neutral';
    return (
      <Badge tone={tone} className="shrink-0">
        ~{forecast.daysRemaining}d restantes
      </Badge>
    );
  }
  return null;
}

export function SupplyBar({ supply, forecast }: { supply: Supply; forecast?: SupplyForecastSummary }) {
  const percent = supply.max_level > 0 ? Math.round((supply.level / supply.max_level) * 100) : null;
  const swatch = supply.colorant ? COLORANT_SWATCH[supply.colorant] : undefined;

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${swatch ?? 'bg-line'}`} />
      <span className="min-w-0 flex-1 truncate text-ink">{supply.description}</span>
      {percent !== null ? (
        <>
          <div className="h-1.5 w-24 shrink-0 overflow-hidden rounded-full bg-surface-2">
            <div className={`h-full ${barColor(percent)}`} style={{ width: `${percent}%` }} />
          </div>
          <span className="w-10 shrink-0 text-right text-xs tabular-nums text-ink-muted">{percent}%</span>
        </>
      ) : (
        <span className="text-xs text-ink-faint">—</span>
      )}
      {forecast && <ForecastPill forecast={forecast} />}
    </div>
  );
}
