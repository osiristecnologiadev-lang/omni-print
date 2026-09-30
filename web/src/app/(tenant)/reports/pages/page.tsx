import Link from 'next/link';
import { forbidden } from 'next/navigation';
import { getViewerAccess, getDevicePagesReport, getCustomers, getSession, getViewerTimeZone } from '@/lib/api';
import { hasPermission } from '@/lib/permissions';
import { PageHeader } from '@/components/PageHeader';
import { Panel } from '@/components/Panel';
import { EmptyState } from '@/components/EmptyState';
import { Button } from '@/components/Button';

const integer = new Intl.NumberFormat('pt-BR');
const selectClass = 'rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent';

function formatReading(value: number | null): string {
  return value == null ? '—' : integer.format(value);
}

function formatReadingDate(iso: string | null, timeZone?: string): string {
  if (!iso) return '';
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', timeZone }).format(new Date(iso));
}

export default async function DevicePagesReportPage(props: PageProps<'/reports/pages'>) {
  const searchParams = await props.searchParams;

  const access = await getViewerAccess();
  if (!hasPermission(access, 'reports')) {
    forbidden();
  }

  const now = new Date();
  const yearParam = Number(searchParams?.year);
  const monthParam = Number(searchParams?.month);
  const year = yearParam >= 2020 && yearParam <= now.getFullYear() + 1 ? yearParam : now.getFullYear();
  const month = monthParam >= 1 && monthParam <= 12 ? monthParam : now.getMonth() + 1;
  const customerId = typeof searchParams?.customerId === 'string' ? searchParams.customerId : '';

  const [session, tz] = await Promise.all([getSession(), getViewerTimeZone()]);
  const isTenantWide = session != null && !session.customerId;
  const [report, customers] = await Promise.all([
    getDevicePagesReport(year, month, customerId || undefined),
    isTenantWide ? getCustomers() : Promise.resolve([]),
  ]);

  const billedPages = report.rows.filter((r) => !r.billingExcluded).reduce((sum, r) => sum + r.pages, 0);
  const excludedCount = report.rows.filter((r) => r.billingExcluded).length;
  const yearOptions = Array.from({ length: 3 }, (_, i) => now.getFullYear() - i);
  const exportQuery = new URLSearchParams({ year: String(year), month: String(month), ...(customerId ? { customerId } : {}) });

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <Link href="/reports" className="text-sm text-ink-muted transition-colors hover:text-accent">
        ← Relatórios
      </Link>
      <PageHeader
        title="Páginas por impressora"
        subtitle="Leitura inicial, leitura final e páginas de cada impressora no mês - não depende de contrato."
      />

      <form method="get" className="mb-6 flex flex-wrap items-center gap-2">
        <select name="month" defaultValue={month} className={selectClass} aria-label="Mês">
          {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
            <option key={m} value={m}>
              {new Intl.DateTimeFormat('pt-BR', { month: 'long' }).format(new Date(2000, m - 1, 1))}
            </option>
          ))}
        </select>
        <select name="year" defaultValue={year} className={selectClass} aria-label="Ano">
          {yearOptions.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
        {isTenantWide && (
          <select name="customerId" defaultValue={customerId} className={selectClass} aria-label="Cliente">
            <option value="">Todos os clientes</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        )}
        <Button type="submit" variant="secondary">
          Ver
        </Button>
      </form>

      <Panel>
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <h2 className="text-sm font-medium text-ink">
              {integer.format(report.totalPages)} páginas em {report.rows.length} impressoras
            </h2>
            {excludedCount > 0 && (
              <p className="mt-0.5 text-xs text-ink-faint">
                {integer.format(billedPages)} páginas nas impressoras do contrato · {excludedCount} fora do contrato
              </p>
            )}
          </div>
          {report.rows.length > 0 && (
            <a href={`/reports/pages/export?${exportQuery}`} className="text-xs text-accent hover:underline">
              Exportar CSV
            </a>
          )}
        </div>

        {report.rows.length === 0 ? (
          <EmptyState title="Nenhuma impressora encontrada" hint="Escolha outro cliente ou mês." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-ink-muted">
                  {isTenantWide && !customerId && <th className="pb-2 pr-3 font-medium">Cliente</th>}
                  <th className="pb-2 pr-3 font-medium">Impressora</th>
                  <th className="pb-2 pr-3 font-medium">Serial</th>
                  <th className="pb-2 pr-3 font-medium">IP</th>
                  <th className="pb-2 pr-3 text-right font-medium">Início</th>
                  <th className="pb-2 pr-3 text-right font-medium">Fim</th>
                  <th className="pb-2 text-right font-medium">Quantidade</th>
                </tr>
              </thead>
              <tbody>
                {report.rows.map((r) => (
                  <tr key={r.deviceId} className={`border-b border-line last:border-0 ${r.billingExcluded ? 'opacity-60' : ''}`}>
                    {isTenantWide && !customerId && (
                      <td className="py-2 pr-3 text-ink-muted">{r.customerName ?? '—'}</td>
                    )}
                    <td className="py-2 pr-3">
                      <Link href={`/devices/${r.deviceId}`} className="text-ink hover:text-accent">
                        {r.deviceName}
                      </Link>
                      {r.billingExcluded && (
                        <span className="ml-2 rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-ink-muted">
                          fora do contrato
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-3 font-mono text-xs text-ink-muted">{r.serialNumber ?? '—'}</td>
                    <td className="py-2 pr-3 font-mono text-xs text-ink-muted">{r.host}</td>
                    <td className="py-2 pr-3 text-right tabular-nums text-ink-muted">
                      {formatReading(r.startReading)}
                      {r.usedManualBaseline && (
                        <span title="Leitura inicial informada manualmente" className="ml-1 text-accent">
                          †
                        </span>
                      )}
                      <div className="text-[11px] text-ink-faint">{formatReadingDate(r.startReadingAt, tz)}</div>
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums text-ink-muted">
                      {formatReading(r.endReading)}
                      <div className="text-[11px] text-ink-faint">{formatReadingDate(r.endReadingAt, tz)}</div>
                    </td>
                    <td className="py-2 text-right tabular-nums font-medium text-ink">
                      {r.startReading == null ? <span className="font-normal text-ink-faint">sem leitura</span> : integer.format(r.pages)}
                      {r.counterReset && (
                        <span title="Contador reiniciou no período - páginas já recalculadas" className="ml-1 text-amber-600 dark:text-amber-400">
                          *
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-4 text-xs text-ink-faint">
          A data abaixo de cada leitura mostra quando ela foi coletada. Se o monitoramento começou no meio do mês, o
          início é a primeira coleta (ou a leitura inicial manual, marcada com †).
        </p>
      </Panel>
    </main>
  );
}
