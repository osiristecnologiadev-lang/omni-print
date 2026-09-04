import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  getDevice,
  getDeviceMetrics,
  getDevicePageTrend,
  getDeviceSupplyTrend,
  getDeviceSupplyForecast,
  getCustomers,
  getSession,
} from '@/lib/api';
import { deriveHealth } from '@/lib/health';
import { StatusBadge } from '@/components/StatusBadge';
import { SupplyBar } from '@/components/SupplyBar';
import { SupplyForecastFacts } from '@/components/SupplyForecastFacts';
import { Panel, PanelSection } from '@/components/Panel';
import { Button } from '@/components/Button';
import { TrendChart } from '@/components/TrendChart';
import { assignCustomerAction, updateLabelAction } from './actions';

const fieldClass =
  'rounded-lg border border-line bg-surface px-2 py-1 text-xs text-ink outline-none transition-colors focus:border-accent';
const integer = new Intl.NumberFormat('pt-BR');

function formatShortDate(dateStr: string): string {
  const [, month, day] = dateStr.split('-');
  return `${day}/${month}`;
}

function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'medium' }).format(new Date(iso));
}

function formatPageCount(value: string | null): string {
  if (value == null) return '—';
  return new Intl.NumberFormat('pt-BR').format(Number(value));
}

function formatUptime(ticks: string | null): string {
  if (ticks == null) return '—';
  const totalSeconds = Number(ticks) / 100; // SNMP TimeTicks are hundredths of a second
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  return `${days}d ${hours}h`;
}

export default async function DevicePage(props: PageProps<'/devices/[id]'>) {
  const { id } = await props.params;
  const searchParams = await props.searchParams;
  const justSaved = searchParams?.saved === '1';

  const device = await getDevice(id);
  if (!device) {
    notFound();
  }

  const [metrics, session, pageTrend, supplyTrend, supplyForecast] = await Promise.all([
    getDeviceMetrics(id, 50),
    getSession(),
    getDevicePageTrend(id, 30),
    getDeviceSupplyTrend(id, 30),
    getDeviceSupplyForecast(id, 90),
  ]);
  const forecastByDescription = new Map(supplyForecast.map((f) => [f.description, f]));
  const isTenantWide = session != null && !session.customerId;
  const customers = isTenantWide ? await getCustomers() : [];
  const pageTrendData = pageTrend.map((p) => ({ label: formatShortDate(p.date), value: p.pages }));
  const supplyTrendData = supplyTrend
    .filter((p): p is { date: string; percent: number } => p.percent != null)
    .map((p) => ({ label: formatShortDate(p.date), value: p.percent }));

  const health = deriveHealth(device.latestMetric);
  const latest = metrics[0];
  const boundAssignCustomer = assignCustomerAction.bind(null, device.id);
  const boundUpdateLabel = updateLabelAction.bind(null, device.id);
  const agentReportedName = device.printerName ?? device.name ?? device.host;

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <Link href="/dashboard" className="text-sm text-ink-muted transition-colors hover:text-accent">
        ← Voltar
      </Link>

      {justSaved && (
        <p className="mt-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
          Cliente atualizado.
        </p>
      )}

      <header className="mt-4 mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-balance text-ink">{device.customLabel ?? agentReportedName}</h1>
          <p className="mt-1 text-sm text-ink-muted">
            {device.host}
            {device.serialNumber ? ` · S/N ${device.serialNumber}` : ''}
            {device.customLabel ? ` · reportado pelo agente como "${agentReportedName}"` : ''}
          </p>
          {isTenantWide && (
            <form action={boundUpdateLabel} className="mt-3 flex items-center gap-2">
              <label htmlFor="customLabel" className="text-xs text-ink-muted">
                Apelido:
              </label>
              <input
                id="customLabel"
                name="customLabel"
                defaultValue={device.customLabel ?? ''}
                placeholder="ex.: Recepção 2º andar"
                className={fieldClass}
              />
              <Button type="submit" variant="secondary" size="sm">
                Salvar
              </Button>
            </form>
          )}
          {isTenantWide ? (
            <form action={boundAssignCustomer} className="mt-3 flex items-center gap-2">
              <label htmlFor="customerId" className="text-xs text-ink-muted">
                Cliente:
              </label>
              <select id="customerId" name="customerId" defaultValue={device.customerId ?? ''} className={fieldClass}>
                <option value="">Sem cliente</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <Button type="submit" variant="secondary" size="sm">
                Salvar
              </Button>
            </form>
          ) : (
            device.customer && <p className="mt-2 text-xs text-ink-muted">Cliente: {device.customer.name}</p>
          )}
        </div>
        <StatusBadge health={health} />
      </header>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <Panel>
          <h2 className="mb-3 text-sm font-medium text-ink-muted">Suprimentos</h2>
          {latest?.supplies && latest.supplies.length > 0 ? (
            <div className="space-y-3">
              {latest.supplies
                .filter((s) => s.class === 'supply')
                .map((s, i) => {
                  const raw = forecastByDescription.get(s.description);
                  const forecast = raw && {
                    ...raw,
                    leftoverPercent: raw.replacement?.leftoverPercent ?? null,
                    replacedAt: raw.replacement?.at ?? null,
                  };
                  return (
                    <div key={i}>
                      <SupplyBar supply={s} forecast={forecast ?? undefined} />
                      {forecast && (
                        <div className="mt-0.5 pl-4">
                          <SupplyForecastFacts forecast={forecast} />
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>
          ) : (
            <p className="text-sm text-ink-faint">Sem dados de suprimento.</p>
          )}
        </Panel>

        <Panel>
          <h2 className="mb-3 text-sm font-medium text-ink-muted">Informações</h2>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-ink-muted">Páginas impressas</dt>
              <dd className="tabular-nums font-medium text-ink">{formatPageCount(latest?.pageCount ?? null)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-ink-muted">Tempo ligada</dt>
              <dd className="text-ink">{formatUptime(latest?.uptimeTicks ?? null)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-ink-muted">Painel</dt>
              <dd className="text-ink">{latest?.consoleDisplay || '—'}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-ink-muted">Descrição (SNMP)</dt>
              <dd className="max-w-[60%] text-right text-ink">{latest?.sysDescr || '—'}</dd>
            </div>
          </dl>
        </Panel>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-2">
        <Panel>
          <h2 className="mb-1 text-sm font-medium text-ink-muted">Páginas por dia</h2>
          <p className="mb-4 text-xs text-ink-faint">Últimos 30 dias.</p>
          <TrendChart data={pageTrendData} formatValue={(v) => integer.format(Math.round(v))} />
        </Panel>
        <Panel>
          <h2 className="mb-1 text-sm font-medium text-ink-muted">Suprimento mais baixo</h2>
          <p className="mb-4 text-xs text-ink-faint">Menor nível entre os consumíveis, últimos 30 dias.</p>
          <TrendChart data={supplyTrendData} formatValue={(v) => `${Math.round(v)}%`} />
        </Panel>
      </div>

      <PanelSection title="Histórico de coletas" className="mt-6">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-surface-2 text-xs uppercase tracking-wide text-ink-muted">
              <tr>
                <th className="px-5 py-2 font-medium">Coletado em</th>
                <th className="px-5 py-2 font-medium">Status</th>
                <th className="px-5 py-2 font-medium">Páginas</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {metrics.map((m) => (
                <tr key={m.id}>
                  <td className="px-5 py-2 text-ink-muted">{formatDateTime(m.collectedAt)}</td>
                  <td className="px-5 py-2">
                    <StatusBadge health={deriveHealth(m)} />
                  </td>
                  <td className="px-5 py-2 tabular-nums text-ink-muted">{formatPageCount(m.pageCount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </PanelSection>
    </main>
  );
}
