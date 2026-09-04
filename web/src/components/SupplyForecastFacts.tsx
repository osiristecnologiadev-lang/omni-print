// Every field the forecast produces (api/src/common/supply-forecast.util.ts),
// shown explicitly rather than folded into one summary badge - the user
// asked directly for this: currentPercent, dailyConsumptionPercent,
// daysRemaining, estimatedEmptyDate, likelyEmptyAlready, and
// premature+leftoverPercent all need to be visible, not just implied by a
// single pill. Used on the device page, the dashboard's low-supply panel,
// and the customer page.

function formatShortDate(dateStr: string): string {
  const [, month, day] = dateStr.split('-');
  return `${day}/${month}`;
}

export interface SupplyForecastFactsData {
  currentPercent: number;
  dailyConsumptionPercent: number | null;
  daysRemaining: number | null;
  estimatedEmptyDate: string | null;
  likelyEmptyAlready: boolean;
  premature: boolean;
  leftoverPercent: number | null;
  replacedAt?: string | null; // ISO date/datetime - only known on the per-device forecast, not the fleet-wide list
}

export function SupplyForecastFacts({ forecast }: { forecast: SupplyForecastFactsData }) {
  const facts: string[] = [`${forecast.currentPercent}% agora`];
  if (forecast.dailyConsumptionPercent != null) {
    facts.push(`${forecast.dailyConsumptionPercent}%/dia de consumo`);
  }
  if (forecast.daysRemaining != null) {
    facts.push(`${forecast.daysRemaining} dia${forecast.daysRemaining === 1 ? '' : 's'} restante${forecast.daysRemaining === 1 ? '' : 's'}`);
  }
  if (forecast.estimatedEmptyDate) {
    facts.push(`esgota em ${formatShortDate(forecast.estimatedEmptyDate)}`);
  }

  return (
    <div className="text-xs text-ink-faint">
      <p>{facts.join(' · ')}</p>
      {forecast.likelyEmptyAlready && (
        <p className="text-red-600 dark:text-red-400">Provavelmente já esgotado - última leitura ainda não confirmou.</p>
      )}
      {forecast.premature && (
        <p className="text-sky-600 dark:text-sky-400">
          Cartucho anterior trocado{forecast.replacedAt ? ` em ${formatShortDate(forecast.replacedAt.slice(0, 10))}` : ''} com{' '}
          {forecast.leftoverPercent}% restante.
        </p>
      )}
    </div>
  );
}
