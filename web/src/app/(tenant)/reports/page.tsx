import { forbidden } from 'next/navigation';
import { getSession, getUsageRevenueReport } from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import { Panel } from '@/components/Panel';
import { EmptyState } from '@/components/EmptyState';
import { TrendChart } from '@/components/TrendChart';

const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const integer = new Intl.NumberFormat('pt-BR');

function formatMonth(iso: string): string {
  const [year, month] = iso.split('-');
  return new Intl.DateTimeFormat('pt-BR', { month: 'short', year: '2-digit' }).format(new Date(Number(year), Number(month) - 1, 1));
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface px-5 py-4">
      <p className="text-xs font-medium text-ink-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-ink">{value}</p>
    </div>
  );
}

const selectClass = 'rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent';
const MONTH_OPTIONS = [3, 6, 12, 24];

export default async function ReportsPage(props: PageProps<'/reports'>) {
  const searchParams = await props.searchParams;

  const session = await getSession();
  if (session?.customerId) {
    forbidden();
  }

  const months = MONTH_OPTIONS.includes(Number(searchParams?.months)) ? Number(searchParams?.months) : 12;
  const report = await getUsageRevenueReport(months);

  const revenueTrend = report.monthly.map((m) => ({ label: formatMonth(m.month), value: m.totalDue }));
  const pagesTrend = report.monthly.map((m) => ({ label: formatMonth(m.month), value: m.totalPages }));

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <PageHeader
        title="Uso e receita"
        subtitle="Visão consolidada de tudo o que foi faturado e impresso pelos seus clientes, por período."
      />

      <form method="get" className="mb-6 flex items-center gap-2">
        <label className="text-xs text-ink-muted">
          Período
          <select name="months" defaultValue={months} className={`ml-2 ${selectClass}`}>
            {MONTH_OPTIONS.map((m) => (
              <option key={m} value={m}>
                Últimos {m} meses
              </option>
            ))}
          </select>
        </label>
      </form>

      <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile label="Receita total" value={currency.format(report.totalRevenue)} />
        <Tile label="Recebido" value={currency.format(report.totalPaid)} />
        <Tile label="Em aberto" value={currency.format(report.totalOutstanding)} />
        <Tile label="Páginas impressas" value={integer.format(report.totalPages)} />
      </div>

      <Panel className="mb-6">
        <h2 className="mb-4 text-sm font-medium text-ink">Receita por mês</h2>
        <TrendChart data={revenueTrend} formatValue={(v) => currency.format(v)} emptyLabel="Sem faturas neste período ainda." />
      </Panel>

      <Panel className="mb-8">
        <h2 className="mb-4 text-sm font-medium text-ink">Páginas por mês</h2>
        <TrendChart data={pagesTrend} formatValue={(v) => integer.format(v)} emptyLabel="Sem faturas neste período ainda." />
      </Panel>

      <Panel>
        <h2 className="mb-4 text-sm font-medium text-ink">Por cliente</h2>
        {report.byCustomer.length === 0 ? (
          <EmptyState title="Nenhum cliente faturado neste período" hint="Gere faturas para ver o comparativo aqui." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-ink-muted">
                  <th className="pb-2 font-medium">Cliente</th>
                  <th className="pb-2 font-medium">Faturas</th>
                  <th className="pb-2 text-right font-medium">Páginas</th>
                  <th className="pb-2 text-right font-medium">Faturado</th>
                  <th className="pb-2 text-right font-medium">Recebido</th>
                  <th className="pb-2 text-right font-medium">Em aberto</th>
                </tr>
              </thead>
              <tbody>
                {report.byCustomer.map((c) => (
                  <tr key={c.customerId} className="border-b border-line last:border-0">
                    <td className="py-2.5 text-ink">{c.customerName}</td>
                    <td className="py-2.5 tabular-nums text-ink-muted">{c.invoiceCount}</td>
                    <td className="py-2.5 text-right tabular-nums text-ink-muted">{integer.format(c.totalPages)}</td>
                    <td className="py-2.5 text-right tabular-nums text-ink">{currency.format(c.totalDue)}</td>
                    <td className="py-2.5 text-right tabular-nums text-ink-muted">{currency.format(c.paidAmount)}</td>
                    <td className={`py-2.5 text-right tabular-nums ${c.outstanding > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-ink-muted'}`}>
                      {currency.format(c.outstanding)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </main>
  );
}
