import Link from 'next/link';
import {
  getActiveAlerts,
  getBillingAlerts,
  getCustomers,
  getDevices,
  getFleetPageTrend,
  getFleetCurrentMonthPages,
  getLowSupplyForecast,
  getPortfolioCurrentPeriod,
  getSession,
  getSubscriptionStatus,
  getViewerAccess,
} from '@/lib/api';
import { hasPermission } from '@/lib/permissions';
import { deriveHealth } from '@/lib/health';
import { Badge, type BadgeTone } from '@/components/Badge';
import { Button } from '@/components/Button';
import { DeviceFleetTable } from '@/components/DeviceFleetTable';
import { PageHeader } from '@/components/PageHeader';
import { Panel, PanelSection } from '@/components/Panel';
import { EmptyState } from '@/components/EmptyState';
import { TrendChart } from '@/components/TrendChart';
import { SupplyForecastFacts } from '@/components/SupplyForecastFacts';

const integer = new Intl.NumberFormat('pt-BR');

const SEVERITY_TONE: Record<string, BadgeTone> = { critical: 'critical', warning: 'warning', other: 'neutral' };
const SEVERITY_LABEL: Record<string, string> = { critical: 'Crítico', warning: 'Atenção', other: 'Aviso' };

function formatShortDate(dateStr: string): string {
  const [, month, day] = dateStr.split('-');
  return `${day}/${month}`;
}

const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

// For values that are a UTC-midnight-anchored calendar date (like
// periodStart, always the 1st of a month), not a specific instant -
// formatting with the server/browser's local timezone would shift it back
// a day for any negative-offset locale (confirmed: this app's own dev
// server, America/Cuiaba UTC-4, showed "31/08" for a September 1st UTC
// timestamp). Read the UTC calendar fields directly instead.
function formatUtcDate(iso: string): string {
  const d = new Date(iso);
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeZone: 'UTC' }).format(d);
}

// Both call sites are calendar dates (invoice due date, contract end date)
// - timeZone: 'UTC' is deliberate here, same reasoning as formatUtcDate
// above.
function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeZone: 'UTC' }).format(new Date(iso));
}

function formatPageCount(value: number | string | null | undefined): string {
  if (value == null) return '—';
  return new Intl.NumberFormat('pt-BR').format(Number(value));
}

function StatTile({ label, value, tone = 'default' }: { label: string; value: number; tone?: 'default' | 'warning' | 'critical' }) {
  const valueClass =
    tone === 'critical' ? 'text-red-600 dark:text-red-400' : tone === 'warning' ? 'text-amber-600 dark:text-amber-400' : 'text-ink';
  return (
    <div className="rounded-xl border border-line bg-surface px-5 py-4">
      <p className="text-xs font-medium text-ink-muted">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${valueClass}`}>{integer.format(value)}</p>
    </div>
  );
}

export default async function DashboardPage() {
  const [devices, session, access] = await Promise.all([getDevices(), getSession(), getViewerAccess()]);
  const isTenantWide = session != null && !session.customerId;
  // Gated by the reports permission, not isTenantWide alone - a restricted
  // tenant-wide user (e.g. a technician with only devices/tickets) has no
  // 'reports' permission either, and without this check these two calls
  // would 403 and take down the whole dashboard, the page every session
  // lands on right after login.
  const canSeeReports = hasPermission(access, 'reports');
  // Only needed to pick which empty state to show below - not fetched at
  // all once the fleet has devices, and not fetched for a session that
  // can't manage customers anyway (it would just 403).
  const canManageCustomers = isTenantWide && hasPermission(access, 'customers');
  const [alerts, activeAlerts, pageTrend, lowSupplies, currentPeriod, currentMonthPages, subscription, customers] =
    await Promise.all([
      canSeeReports ? getBillingAlerts() : Promise.resolve(null),
      getActiveAlerts(),
      getFleetPageTrend(30),
      getLowSupplyForecast(14, 90),
      canSeeReports ? getPortfolioCurrentPeriod() : Promise.resolve(null),
      getFleetCurrentMonthPages(),
      getSubscriptionStatus(),
      devices.length === 0 && canManageCustomers ? getCustomers() : Promise.resolve([]),
    ]);
  const trialDaysLeft = Math.ceil((new Date(subscription.trialEndsAt).getTime() - Date.now()) / 86_400_000);
  const hasAlerts = !!alerts && (alerts.expiringContracts.length > 0 || alerts.overdueInvoices.length > 0);
  const trendData = pageTrend.map((p) => ({ label: formatShortDate(p.date), value: p.pages }));

  const healths = devices.map((d) => deriveHealth(d.latestMetric));
  const criticalCount = healths.filter((h) => h.tone === 'critical').length;
  const warningCount = healths.filter((h) => h.tone === 'warning').length;
  const okCount = devices.length - criticalCount - warningCount;

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <PageHeader
        title="Parque de impressoras"
        subtitle={`${devices.length} dispositivo${devices.length === 1 ? '' : 's'} monitorado${devices.length === 1 ? '' : 's'}`}
      />

      {!subscription.isComped && subscription.status === 'TRIALING' && (
        <div className="mb-8 rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900/50 dark:bg-amber-900/20">
          <p className="text-sm text-amber-900 dark:text-amber-200">
            {trialDaysLeft > 0
              ? `Seu período de teste acaba em ${trialDaysLeft} dia${trialDaysLeft === 1 ? '' : 's'}.`
              : 'Seu período de teste acaba hoje.'}{' '}
            <Link href="/subscribe" className="font-medium hover:underline">
              Assine para continuar usando o OmniPrint
            </Link>
            .
          </p>
        </div>
      )}

      {devices.length > 0 && (
        <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-5">
          <StatTile label="Total" value={devices.length} />
          <StatTile label="Normais" value={okCount} />
          <StatTile label="Atenção" value={warningCount} tone="warning" />
          <StatTile label="Críticos" value={criticalCount} tone="critical" />
          <StatTile label="Páginas este mês" value={currentMonthPages.totalPages} />
        </div>
      )}

      {canSeeReports && currentPeriod && currentPeriod.byCustomer.length > 0 && (
        <Panel className="mb-8">
          <div className="mb-1 flex items-baseline justify-between gap-3">
            <h2 className="text-sm font-medium text-ink">Receita garantida este mês (até agora)</h2>
            <Link href="/reports" className="text-xs text-accent hover:underline">
              Ver relatórios
            </Link>
          </div>
          <p className="mb-3 text-xs text-ink-faint">
            Baseado no que já foi impresso desde {formatUtcDate(currentPeriod.periodStart)} - o mês ainda não fechou, então
            este valor só cresce até a fatura ser gerada.
          </p>
          <p className="mb-3 text-2xl font-semibold tabular-nums text-ink">{currency.format(currentPeriod.totalAccrued)}</p>
          <ul className="divide-y divide-line">
            {currentPeriod.byCustomer.map((c) => (
              <li key={c.customerId} className="flex items-center justify-between py-2 text-sm">
                <Link href={`/customers/${c.customerId}/contract`} className="text-ink transition-colors hover:text-accent">
                  {c.customerName}
                </Link>
                <span className="tabular-nums text-ink-muted">{currency.format(c.totalDue)}</span>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {hasAlerts && alerts && (
        <div className="mb-8 rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900/50 dark:bg-amber-900/20">
          <h2 className="mb-2 text-sm font-medium text-amber-900 dark:text-amber-200">Cobrança precisa de atenção</h2>
          <ul className="space-y-1.5 text-sm text-amber-800 dark:text-amber-300">
            {alerts.overdueInvoices.map((inv) => (
              <li key={inv.id}>
                <Link href={`/customers/${inv.customerId}/invoices`} className="hover:underline">
                  Fatura de {inv.customer.name} vencida em {formatDate(inv.dueDate)} ({currency.format(Number(inv.totalDue))})
                </Link>
              </li>
            ))}
            {alerts.expiringContracts.map((c) => (
              <li key={c.id}>
                <Link href={`/customers/${c.customerId}/contract`} className="hover:underline">
                  Contrato com {c.customer.name} vence em {formatDate(c.endDate!)}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {activeAlerts.length > 0 && (
        <PanelSection title={`Alertas ativos da frota (${activeAlerts.length})`} className="mb-8">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-surface-2 text-xs uppercase tracking-wide text-ink-muted">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Dispositivo</th>
                  <th className="px-4 py-2.5 font-medium">IP</th>
                  <th className="px-4 py-2.5 font-medium">Nº de série</th>
                  {isTenantWide && <th className="px-4 py-2.5 font-medium">Cliente</th>}
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 font-medium">Páginas</th>
                  <th className="px-4 py-2.5 font-medium">Descrição</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {activeAlerts.map((a, i) => (
                  <tr key={`${a.deviceId}-${i}`} className="transition-colors hover:bg-surface-2">
                    <td className="px-4 py-2.5">
                      <Link href={`/devices/${a.deviceId}`} className="font-medium text-ink transition-colors hover:text-accent">
                        {a.deviceName}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs text-ink-muted">{a.host}</td>
                    <td className="px-4 py-2.5 font-mono text-xs text-ink-muted">{a.serialNumber ?? '—'}</td>
                    {isTenantWide && (
                      <td className="px-4 py-2.5 text-ink-muted">
                        {a.customerName ?? <span className="text-ink-faint">—</span>}
                      </td>
                    )}
                    <td className="px-4 py-2.5">
                      <Badge tone={SEVERITY_TONE[a.severity] ?? 'neutral'}>{SEVERITY_LABEL[a.severity] ?? a.severity}</Badge>
                    </td>
                    <td className="px-4 py-2.5 tabular-nums text-ink-muted">
                      {formatPageCount(a.pageCount)}
                      {a.enginePageCount != null && a.pageCount !== Number(a.enginePageCount) && (
                        <div className="text-xs text-ink-faint">mecanismo: {formatPageCount(a.enginePageCount)}</div>
                      )}
                    </td>
                    <td className="max-w-[320px] truncate px-4 py-2.5 text-xs text-ink-faint">{a.description ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </PanelSection>
      )}

      {lowSupplies.length > 0 && (
        <Panel className="mb-8">
          <h2 className="mb-1 text-sm font-medium text-ink">Suprimentos que precisam de atenção</h2>
          <p className="mb-3 text-xs text-ink-faint">
            Previsão a partir do consumo real dos últimos 90 dias - só aparece aqui quem tem dado suficiente para uma
            previsão confiável.
          </p>
          <ul className="divide-y divide-line">
            {lowSupplies.map((s, i) => (
              <li key={`${s.deviceId}-${i}`} className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1 py-2.5 text-sm">
                <div className="flex min-w-0 items-center gap-2">
                  {s.premature ? (
                    <Badge tone="info">Troca antecipada</Badge>
                  ) : s.likelyEmptyAlready ? (
                    <Badge tone="critical">Provavelmente vazio</Badge>
                  ) : (
                    <Badge tone="warning">{s.daysRemaining}d restantes</Badge>
                  )}
                  <Link href={`/devices/${s.deviceId}`} className="truncate font-medium text-ink transition-colors hover:text-accent">
                    {s.deviceName}
                  </Link>
                  <span className="truncate text-xs text-ink-faint">{s.description}</span>
                </div>
                <SupplyForecastFacts forecast={s} />
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {devices.length > 0 && (
        <Panel className="mb-8">
          <h2 className="mb-1 text-sm font-medium text-ink">Páginas impressas por dia</h2>
          <p className="mb-4 text-xs text-ink-faint">Últimos 30 dias, somado em toda a frota.</p>
          <TrendChart data={trendData} formatValue={(v) => integer.format(Math.round(v))} />
        </Panel>
      )}

      {devices.length === 0 ? (
        canManageCustomers && customers.length === 0 ? (
          <EmptyState
            title="Nenhum dispositivo ainda"
            hint="Primeiro passo: cadastre o cliente cujas impressoras você vai monitorar."
            action={
              <Link href="/customers">
                <Button variant="primary">Cadastrar primeiro cliente</Button>
              </Link>
            }
          />
        ) : canManageCustomers ? (
          <EmptyState
            title="Nenhum dispositivo ainda"
            hint="Gere um código de instalação para o cliente e instale o agente na rede dele - as impressoras aparecem aqui sozinhas depois do primeiro ciclo de coleta (a cada ~30 min)."
            action={
              <Link href="/agent-download">
                <Button variant="primary">Baixar o agente</Button>
              </Link>
            }
          />
        ) : (
          <EmptyState
            title="Nenhum dispositivo atribuído a você ainda"
            hint="Fale com o administrador da sua conta para associar impressoras ao seu usuário."
          />
        )
      ) : (
        <DeviceFleetTable
          devices={devices.map((d) => ({ ...d, health: deriveHealth(d.latestMetric) }))}
          isTenantWide={isTenantWide}
        />
      )}
    </main>
  );
}
