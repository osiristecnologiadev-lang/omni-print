import { Alert, LatestMetric, Metric, Supply, lowestSupplyPercent } from './api';

export type HealthTone = 'ok' | 'info' | 'warning' | 'critical' | 'neutral';

export interface Health {
  tone: HealthTone;
  label: string;
}

const STATUS_LABELS: Record<string, string> = {
  idle: 'Ociosa',
  printing: 'Imprimindo',
  warmup: 'Aquecendo',
  other: 'Status desconhecido',
  unknown: 'Status desconhecido',
};

interface NormalizedMetric {
  online: boolean;
  errorMessage: string | null;
  errorState: Record<string, boolean> | null;
  alerts: Alert[] | null;
  supplies: Supply[] | null;
  printerStatus: string | null;
}

// LatestMetric (snake_case, from the backend's raw SQL) and Metric
// (camelCase, from Prisma) carry the same information under different key
// casing - normalize once so the rest of this file doesn't need to care
// which one it got.
function normalize(metric: LatestMetric | Metric): NormalizedMetric {
  if ('printer_status' in metric) {
    return {
      online: metric.online,
      errorMessage: metric.error_message ?? null,
      errorState: metric.error_state,
      alerts: metric.alerts,
      supplies: metric.supplies,
      printerStatus: metric.printer_status,
    };
  }
  return {
    online: metric.online,
    errorMessage: metric.errorMessage ?? null,
    errorState: metric.errorState,
    alerts: metric.alerts,
    supplies: metric.supplies,
    printerStatus: metric.printerStatus,
  };
}

// One badge that summarizes a metric snapshot: offline/error takes priority
// over low supplies, which takes priority over just showing the printer's
// own reported status.
export function deriveHealth(metric: LatestMetric | Metric | null | undefined): Health {
  if (!metric) {
    return { tone: 'neutral', label: 'Sem dados' };
  }

  const m = normalize(metric);

  if (!m.online) {
    // A printer the agent knows is up on the network (Active Directory or a
    // print server named it, and it answers on a printing port) but that
    // doesn't answer SNMP - not down, just not monitorable yet. The prefix
    // must match agent/internal/collector's NoSNMPError.
    if (m.errorMessage?.startsWith('Sem resposta SNMP')) {
      return { tone: 'warning', label: 'Sem SNMP' };
    }
    return { tone: 'critical', label: 'Offline' };
  }

  const activeErrors = Object.entries(m.errorState ?? {}).filter(([, v]) => v);
  if (activeErrors.length > 0) {
    return { tone: 'critical', label: activeErrors[0][0] };
  }

  if (m.alerts && m.alerts.length > 0) {
    const hasCritical = m.alerts.some((a) => a.severity === 'critical');
    return { tone: hasCritical ? 'critical' : 'warning', label: `${m.alerts.length} alerta(s)` };
  }

  const lowest = lowestSupplyPercent(metric);
  if (lowest !== null && lowest < 10) {
    return { tone: 'critical', label: `Suprimento crítico (${Math.round(lowest)}%)` };
  }
  if (lowest !== null && lowest < 25) {
    return { tone: 'warning', label: `Suprimento baixo (${Math.round(lowest)}%)` };
  }

  const label = (m.printerStatus && STATUS_LABELS[m.printerStatus]) || m.printerStatus || 'OK';
  return { tone: m.printerStatus === 'printing' ? 'info' : 'ok', label };
}
