import Link from 'next/link';
import { forbidden } from 'next/navigation';
import { getViewerAccess, getAllInvoices, type InvoiceOverviewRow, type InvoiceStatus } from '@/lib/api';
import { hasPermission } from '@/lib/permissions';
import { PageHeader } from '@/components/PageHeader';
import { Panel } from '@/components/Panel';
import { EmptyState } from '@/components/EmptyState';
import { Badge, type BadgeTone } from '@/components/Badge';

const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const int = new Intl.NumberFormat('pt-BR');

// Period and due dates are calendar dates stored at UTC midnight.
function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeZone: 'UTC' }).format(new Date(iso));
}

function isOverdue(i: InvoiceOverviewRow): boolean {
  return i.status === 'PENDING' && new Date(i.dueDate).getTime() < Date.now();
}

function statusOf(i: InvoiceOverviewRow): { label: string; tone: BadgeTone } {
  if (isOverdue(i)) return { label: 'Atrasada', tone: 'critical' };
  if (i.status === 'PENDING') return { label: 'Em aberto', tone: 'warning' };
  if (i.status === 'PAID') return { label: 'Paga', tone: 'ok' };
  return { label: 'Cancelada', tone: 'neutral' };
}

const STATUS_OPTIONS: Array<{ value: '' | InvoiceStatus; label: string }> = [
  { value: '', label: 'Todas' },
  { value: 'PENDING', label: 'Em aberto' },
  { value: 'PAID', label: 'Pagas' },
  { value: 'CANCELLED', label: 'Canceladas' },
];
const MONTHS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
const selectClass = 'rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent';

function Tile({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface px-5 py-4">
      <p className="text-xs font-medium text-ink-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-ink">{value}</p>
      <p className="mt-1 text-[11px] text-ink-faint">{hint}</p>
    </div>
  );
}

export default async function InvoicesPage(props: PageProps<'/invoices'>) {
  const access = await getViewerAccess();
  if (!hasPermission(access, 'invoices')) {
    forbidden();
  }
  const sp = await props.searchParams;
  const status = STATUS_OPTIONS.some((o) => o.value && o.value === sp?.status) ? (sp?.status as InvoiceStatus) : undefined;
  const month = Number(sp?.month);
  const year = Number(sp?.year);
  const byMonth = Number.isInteger(month) && month >= 1 && month <= 12 && Number.isInteger(year) && year > 2000;

  const invoices = await getAllInvoices({ status, ...(byMonth ? { year, month } : {}) });

  const open = invoices.filter((i) => i.status === 'PENDING');
  const overdue = open.filter(isOverdue);
  const sum = (list: InvoiceOverviewRow[]) => list.reduce((s, i) => s + Number(i.totalDue), 0);
  const paid = invoices.filter((i) => i.status === 'PAID');

  const now = new Date();
  const years = [now.getFullYear() - 1, now.getFullYear()];

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <PageHeader
        title="Faturas"
        subtitle="Todas as faturas de todos os clientes. Cada uma é gerada no dia de fechamento do cliente, com os valores exatos daquele período."
      />

      <form method="get" className="mb-6 flex flex-wrap items-end gap-3">
        <label className="text-xs text-ink-muted">
          Situação
          <select name="status" defaultValue={status ?? ''} className={`mt-1 block ${selectClass}`}>
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-ink-muted">
          Mês de referência
          <select name="month" defaultValue={byMonth ? String(month) : ''} className={`mt-1 block ${selectClass}`}>
            <option value="">Todos</option>
            {MONTHS.map((m, i) => (
              <option key={m} value={i + 1}>
                {m}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-ink-muted">
          Ano
          <select name="year" defaultValue={byMonth ? String(year) : String(now.getFullYear())} className={`mt-1 block ${selectClass}`}>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="rounded-lg border border-line bg-surface-2 px-4 py-2 text-sm text-ink hover:border-accent">
          Filtrar
        </button>
      </form>

      <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile label="Faturas na lista" value={int.format(invoices.length)} hint={byMonth ? `Referência ${MONTHS[month - 1]}/${year}` : 'Todos os meses'} />
        <Tile label="Em aberto" value={money.format(sum(open))} hint={`${open.length} fatura(s) ainda não paga(s)`} />
        <Tile label="Atrasadas" value={money.format(sum(overdue))} hint={`${overdue.length} já passaram do vencimento`} />
        <Tile label="Recebido" value={money.format(paid.reduce((s, i) => s + Number(i.paidAmount ?? i.totalDue), 0))} hint={`${paid.length} fatura(s) paga(s)`} />
      </div>

      <Panel>
        {invoices.length === 0 ? (
          <EmptyState
            title="Nenhuma fatura encontrada"
            hint="As faturas são geradas automaticamente no dia de fechamento de cada cliente com contrato. Também dá para gerar uma manualmente na página de faturas do cliente."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-ink-muted">
                  <th className="pb-2 pr-4 font-medium">Nº</th>
                  <th className="pb-2 pr-4 font-medium">Cliente</th>
                  <th className="pb-2 pr-4 font-medium">Período</th>
                  <th className="pb-2 pr-4 font-medium">Vencimento</th>
                  <th className="pb-2 pr-4 text-right font-medium">Páginas</th>
                  <th className="pb-2 pr-4 text-right font-medium">Valor</th>
                  <th className="pb-2 pr-4 font-medium">Situação</th>
                  <th className="pb-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {invoices.map((i) => {
                  const st = statusOf(i);
                  return (
                    <tr key={i.id} className="border-b border-line last:border-0">
                      <td className="py-2.5 pr-4 tabular-nums text-ink-muted">{i.number}</td>
                      <td className="py-2.5 pr-4">
                        <Link href={`/customers/${i.customerId}/invoices`} className="text-ink hover:text-accent">
                          {i.customer.name}
                        </Link>
                      </td>
                      <td className="py-2.5 pr-4 text-ink-muted">
                        {formatDate(i.periodStart)} a {formatDate(i.periodEnd)}
                      </td>
                      <td className="py-2.5 pr-4 text-ink-muted">{formatDate(i.dueDate)}</td>
                      <td className="py-2.5 pr-4 text-right tabular-nums text-ink-muted">{int.format(i.totalPages)}</td>
                      <td className="py-2.5 pr-4 text-right tabular-nums text-ink">{money.format(Number(i.totalDue))}</td>
                      <td className="py-2.5 pr-4">
                        <Badge tone={st.tone}>{st.label}</Badge>
                      </td>
                      <td className="py-2.5 text-right whitespace-nowrap">
                        <a href={`/customers/${i.customerId}/invoices/${i.id}/pdf`} className="text-xs text-accent hover:underline">
                          PDF
                        </a>
                        <Link href={`/customers/${i.customerId}/invoices`} className="ml-3 text-xs text-accent hover:underline">
                          Abrir
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      <p className="mt-4 text-xs text-ink-faint">
        Para marcar uma fatura como paga ou cancelá-la, use &ldquo;Abrir&rdquo; - isso leva à página de faturas do cliente.
      </p>
    </main>
  );
}
