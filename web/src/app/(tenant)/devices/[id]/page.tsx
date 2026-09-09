import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  getDevice,
  getDeviceMetrics,
  getDevicePageTrend,
  getDeviceSupplyTrend,
  getDeviceSupplyForecast,
  getDeviceCurrentMonthPages,
  getCustomers,
  getSession,
  getViewerTimeZone,
} from '@/lib/api';
import { displayPageCount, engineDisplayPageCount } from '@/lib/pages';
import { deriveHealth } from '@/lib/health';
import { StatusBadge } from '@/components/StatusBadge';
import { SupplyBar } from '@/components/SupplyBar';
import { SupplyForecastFacts } from '@/components/SupplyForecastFacts';
import { Panel, PanelSection } from '@/components/Panel';
import { SubmitButton } from '@/components/SubmitButton';
import { Banner } from '@/components/Banner';
import { TrendChart } from '@/components/TrendChart';
import { assignCustomerAction, updateLabelAction, updateManualBaselineAction } from './actions';

const fieldClass =
  'rounded-lg border border-line bg-surface px-2 py-1 text-xs text-ink outline-none transition-colors focus:border-accent';
const integer = new Intl.NumberFormat('pt-BR');

function formatShortDate(dateStr: string): string {
  const [, month, day] = dateStr.split('-');
  return `${day}/${month}`;
}

// Server Components render on Railway (UTC) - without an explicit
// timeZone this would always show UTC regardless of who's actually
// looking at the page. See getViewerTimeZone's comment.
function formatDateTime(iso: string, timeZone?: string): string {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'medium', timeZone }).format(new Date(iso));
}

function formatPageCount(value: number | string | null): string {
  if (value == null) return '—';
  return new Intl.NumberFormat('pt-BR').format(Number(value));
}

// Just "DD/MM" - used as a short "desde ..." caption under a page-count
// figure, to make clear which two figures start counting from different
// dates (the manual baseline date vs. a device's first real reading) rather
// than looking like directly comparable totals for the same window.
function formatShortReadingDate(iso: string | null, timeZone?: string): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', timeZone }).format(new Date(iso));
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
  const customerSaved = searchParams?.customerSaved === '1';
  const customerError = searchParams?.customerError === '1';
  const labelSaved = searchParams?.labelSaved === '1';
  const labelError = searchParams?.labelError === '1';
  const baselineSaved = searchParams?.baselineSaved === '1';
  const baselineError = searchParams?.baselineError === '1';

  const device = await getDevice(id);
  if (!device) {
    notFound();
  }

  const [metrics, session, pageTrend, supplyTrend, supplyForecast, currentMonthPages, tz] = await Promise.all([
    getDeviceMetrics(id, 50),
    getSession(),
    getDevicePageTrend(id, 30),
    getDeviceSupplyTrend(id, 30),
    getDeviceSupplyForecast(id, 90),
    getDeviceCurrentMonthPages(id),
    getViewerTimeZone(),
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
  const boundUpdateManualBaseline = updateManualBaselineAction.bind(null, device.id);
  const agentReportedName = device.printerName ?? device.name ?? device.host;

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <Link href="/dashboard" className="text-sm text-ink-muted transition-colors hover:text-accent">
        ← Voltar
      </Link>

      {customerSaved && <Banner tone="success" className="mt-4">Cliente atualizado.</Banner>}
      {customerError && <Banner tone="error" className="mt-4">Não foi possível atualizar o cliente. Tente novamente.</Banner>}
      {labelSaved && <Banner tone="success" className="mt-4">Apelido salvo.</Banner>}
      {labelError && <Banner tone="error" className="mt-4">Não foi possível salvar o apelido. Tente novamente.</Banner>}
      {baselineSaved && <Banner tone="success" className="mt-4">Leitura inicial salva.</Banner>}
      {baselineError && <Banner tone="error" className="mt-4">Não foi possível salvar a leitura inicial. Tente novamente.</Banner>}

      <header className="mt-4 mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-balance text-ink">{device.customLabel ?? agentReportedName}</h1>
          <p className="mt-1 text-sm text-ink-muted">
            {device.host}
            {device.serialNumber ? ` · S/N ${device.serialNumber}` : ''}
          </p>
          <p className="mt-0.5 text-sm text-ink-muted">
            Apelido: {device.customLabel ?? <span className="text-ink-faint">não definido</span>} · Nome do agente:{' '}
            {agentReportedName}
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
              <SubmitButton variant="secondary" size="sm" pendingLabel="Salvando...">
                Salvar
              </SubmitButton>
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
              <SubmitButton variant="secondary" size="sm" pendingLabel="Salvando...">
                Salvar
              </SubmitButton>
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
              <dd className="tabular-nums font-medium text-ink">{formatPageCount(displayPageCount(latest ?? null))}</dd>
            </div>
            {latest && engineDisplayPageCount(latest) != null && displayPageCount(latest) !== engineDisplayPageCount(latest) && (
              <div className="flex justify-between gap-4">
                <dt className="text-ink-muted">Contador do mecanismo</dt>
                <dd className="tabular-nums text-ink-faint">{formatPageCount(engineDisplayPageCount(latest))}</dd>
              </div>
            )}
            <div className="flex justify-between gap-4">
              <dt className="text-ink-muted">
                Impresso este mês (até agora)
                {currentMonthPages.counterReset && (
                  <span
                    title={
                      currentMonthPages.usedFallbackForReset
                        ? 'O contador de páginas impressas reiniciou neste mês - esse trecho foi calculado pelo contador do mecanismo.'
                        : 'Contador reiniciado neste mês - páginas já recalculadas corretamente.'
                    }
                    className="ml-1 text-amber-600 dark:text-amber-400"
                  >
                    *
                  </span>
                )}
                {currentMonthPages.usedManualBaseline && (
                  <span
                    title="Leitura anterior informada manualmente - monitoramento começou depois do início do mês."
                    className="ml-1 text-accent"
                  >
                    †
                  </span>
                )}
              </dt>
              <dd className="text-right">
                <div className="tabular-nums font-medium text-ink">{formatPageCount(currentMonthPages.pages)}</div>
                <div className="text-xs text-ink-faint">desde {formatShortReadingDate(currentMonthPages.startReadingAt, tz)}</div>
              </dd>
            </div>
            {currentMonthPages.enginePages !== currentMonthPages.pages && (
              <div className="flex justify-between gap-4">
                <dt className="text-ink-muted">Mecanismo, este mês</dt>
                <dd className="text-right">
                  <div className="tabular-nums text-ink-faint">{formatPageCount(currentMonthPages.enginePages)}</div>
                  <div className="text-xs text-ink-faint">
                    desde {formatShortReadingDate(currentMonthPages.engineStartReadingAt, tz)}
                  </div>
                </dd>
              </div>
            )}
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

      {isTenantWide && (
        <Panel className="mt-6">
          <h2 className="mb-1 text-sm font-medium text-ink-muted">Leitura inicial manual</h2>
          <p className="mb-4 text-xs text-ink-faint">
            Se este dispositivo já imprimia antes do monitoramento começar, informe aqui a contagem de páginas que ele
            já tinha em uma data conhecida - o faturamento passa a contar a partir desse ponto em vez de só a partir da
            primeira coleta real.
          </p>
          <form action={boundUpdateManualBaseline} className="flex flex-wrap items-end gap-3">
            <div>
              <label htmlFor="manualBaselineDate" className="block text-xs text-ink-muted">
                Data da leitura
              </label>
              <input
                type="date"
                id="manualBaselineDate"
                name="manualBaselineDate"
                defaultValue={device.manualBaselineDate ? device.manualBaselineDate.slice(0, 10) : ''}
                className={`mt-1 ${fieldClass}`}
              />
            </div>
            <div>
              <label htmlFor="manualBaselinePageCount" className="block text-xs text-ink-muted">
                Páginas até essa data
              </label>
              <input
                type="number"
                min={0}
                id="manualBaselinePageCount"
                name="manualBaselinePageCount"
                defaultValue={device.manualBaselinePageCount ?? ''}
                placeholder="ex.: 200000"
                className={`mt-1 w-40 ${fieldClass}`}
              />
            </div>
            <SubmitButton variant="secondary" size="sm" pendingLabel="Salvando...">
              Salvar
            </SubmitButton>
            {device.manualBaselineDate && (
              <p className="w-full text-xs text-ink-faint">
                Deixe os dois campos em branco e salve para remover a leitura manual.
              </p>
            )}
          </form>
        </Panel>
      )}

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
                  <td className="px-5 py-2 text-ink-muted">{formatDateTime(m.collectedAt, tz)}</td>
                  <td className="px-5 py-2">
                    <StatusBadge health={deriveHealth(m)} />
                  </td>
                  <td className="px-5 py-2 tabular-nums text-ink-muted">{formatPageCount(displayPageCount(m))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </PanelSection>
    </main>
  );
}
