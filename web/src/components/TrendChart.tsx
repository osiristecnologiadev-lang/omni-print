interface TrendPoint {
  label: string;
  value: number;
}

// Server-rendered SVG line/area chart - no charting library, no client JS,
// consistent with the rest of this app. Colors come from the CSS custom
// properties (var(--color-...)) so the chart adapts to the light/dark
// token system automatically, same as everything else - see globals.css.
export function TrendChart({
  data,
  formatValue = (v) => String(v),
  height = 160,
  emptyLabel = 'Sem dados suficientes para este período ainda.',
  forceZeroFloor = true,
}: {
  data: TrendPoint[];
  formatValue?: (value: number) => string;
  height?: number;
  emptyLabel?: string;
  forceZeroFloor?: boolean;
}) {
  if (data.length < 2) {
    return (
      <div className="flex items-center justify-center rounded-lg border border-dashed border-line py-10 text-center text-xs text-ink-faint">
        {emptyLabel}
      </div>
    );
  }

  const width = 640;
  const padding = { top: 14, right: 12, bottom: 22, left: 44 };
  const innerW = width - padding.left - padding.right;
  const innerH = height - padding.top - padding.bottom;

  const values = data.map((d) => d.value);
  const rawMax = Math.max(...values);
  const rawMin = Math.min(...values);
  const maxV = rawMax === rawMin ? rawMax + 1 : rawMax;
  const minV = forceZeroFloor ? Math.min(0, rawMin) : rawMin;
  const span = maxV - minV || 1;

  const x = (i: number) => padding.left + (i / (data.length - 1)) * innerW;
  const y = (v: number) => padding.top + innerH - ((v - minV) / span) * innerH;

  const linePath = data.map((d, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(d.value).toFixed(1)}`).join(' ');
  const areaPath = `${linePath} L ${x(data.length - 1).toFixed(1)} ${y(minV).toFixed(1)} L ${x(0).toFixed(1)} ${y(minV).toFixed(1)} Z`;

  const last = data[data.length - 1];
  const first = data[0];
  const mid = data[Math.floor((data.length - 1) / 2)];

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img" aria-label={`Gráfico de tendência, valor mais recente ${formatValue(last.value)}`}>
      <line x1={padding.left} y1={y(maxV)} x2={width - padding.right} y2={y(maxV)} stroke="var(--color-line)" strokeWidth="1" />
      <line x1={padding.left} y1={y(minV)} x2={width - padding.right} y2={y(minV)} stroke="var(--color-line)" strokeWidth="1" />
      <text x={padding.left - 8} y={y(maxV) + 3} textAnchor="end" fontSize="10" fill="var(--color-ink-faint)">
        {formatValue(maxV)}
      </text>
      <text x={padding.left - 8} y={y(minV) + 3} textAnchor="end" fontSize="10" fill="var(--color-ink-faint)">
        {formatValue(minV)}
      </text>

      <path d={areaPath} fill="var(--color-accent)" fillOpacity="0.12" stroke="none" />
      <path d={linePath} fill="none" stroke="var(--color-accent)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(data.length - 1)} cy={y(last.value)} r="3.5" fill="var(--color-accent)" />

      <text x={x(0)} y={height - 6} textAnchor="start" fontSize="10" fill="var(--color-ink-faint)">
        {first.label}
      </text>
      {data.length > 4 && (
        <text x={x(Math.floor((data.length - 1) / 2))} y={height - 6} textAnchor="middle" fontSize="10" fill="var(--color-ink-faint)">
          {mid.label}
        </text>
      )}
      <text x={x(data.length - 1)} y={height - 6} textAnchor="end" fontSize="10" fill="var(--color-ink-faint)">
        {last.label}
      </text>
    </svg>
  );
}
