import { forbidden } from 'next/navigation';
import { getCustomer, getInvoices, getSession, getViewerTimeZone, type Invoice } from '@/lib/api';
import { generateInvoiceAction, markPaidAction, cancelInvoiceAction } from './actions';
import { PageHeader } from '@/components/PageHeader';
import { Panel } from '@/components/Panel';
import { Button } from '@/components/Button';
import { SubmitButton, PlainSubmitButton } from '@/components/SubmitButton';
import { Banner } from '@/components/Banner';
import { Badge, type BadgeTone } from '@/components/Badge';
import { EmptyState } from '@/components/EmptyState';

const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

// periodStart/periodEnd/dueDate are calendar dates - timeZone: 'UTC' is
// deliberate there (see dashboard/page.tsx's formatDate). paidAt is a real
// instant (whenever the "marcar como paga" button was actually clicked),
// so it takes the viewer's own timezone instead - pass it explicitly per
// call site rather than defaulting either way.
function formatDate(iso: string, timeZone: string | undefined = 'UTC'): string {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeZone }).format(new Date(iso));
}

const STATUS_LABEL: Record<string, string> = { PENDING: 'Pendente', PAID: 'Paga', CANCELLED: 'Cancelada' };
const STATUS_TONE: Record<string, BadgeTone> = { PENDING: 'warning', PAID: 'ok', CANCELLED: 'neutral' };

function isOverdue(invoice: Invoice): boolean {
  return invoice.status === 'PENDING' && new Date(invoice.dueDate).getTime() < Date.now();
}

export default async function InvoicesPage(props: PageProps<'/customers/[id]/invoices'>) {
  const { id } = await props.params;
  const searchParams = await props.searchParams;

  const session = await getSession();
  if (session?.customerId) {
    forbidden();
  }

  const [customer, invoices, tz] = await Promise.all([getCustomer(id), getInvoices(id), getViewerTimeZone()]);

  const now = new Date();
  const monthOptions = Array.from({ length: 12 }, (_, i) => i + 1);
  const yearOptions = [now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1];
  const boundGenerate = generateInvoiceAction.bind(null, id);
  const selectClass =
    'rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-ink outline-none transition-colors focus:border-accent';

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <PageHeader
        title="Faturas"
        subtitle="Histórico de cobrança gerado a partir do contrato - cada fatura fica registrada com os valores exatos daquele mês, mesmo que o contrato mude depois."
        back={{ href: `/customers/${id}`, label: customer.name }}
      />

      {searchParams?.generated === '1' && <Banner tone="success">Fatura gerada.</Banner>}
      {searchParams?.error === '1' && (
        <Banner tone="error">Não foi possível gerar a fatura - confira se existe um contrato cobrindo esse período.</Banner>
      )}
      {searchParams?.paid === '1' && <Banner tone="success">Fatura marcada como paga.</Banner>}
      {searchParams?.payError === '1' && <Banner tone="error">Não foi possível marcar a fatura como paga. Tente novamente.</Banner>}
      {searchParams?.cancelled === '1' && <Banner tone="success">Fatura cancelada.</Banner>}
      {searchParams?.cancelError === '1' && <Banner tone="error">Não foi possível cancelar a fatura. Tente novamente.</Banner>}

      <Panel className="mb-6">
        <h2 className="mb-1 text-sm font-medium text-ink">Gerar fatura</h2>
        <p className="mb-4 text-xs text-ink-faint">
          Todo dia, o sistema já gera automaticamente a fatura do mês fechado anterior. Use isto para gerar um mês
          específico antecipadamente ou para preencher um mês antigo.
        </p>
        <form action={boundGenerate} className="flex items-center gap-2">
          <select name="month" defaultValue={now.getMonth() + 1} className={selectClass}>
            {monthOptions.map((m) => (
              <option key={m} value={m}>
                {new Intl.DateTimeFormat('pt-BR', { month: 'long' }).format(new Date(2000, m - 1, 1))}
              </option>
            ))}
          </select>
          <select name="year" defaultValue={now.getFullYear()} className={selectClass}>
            {yearOptions.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
          <SubmitButton variant="primary" pendingLabel="Gerando...">
            Gerar
          </SubmitButton>
        </form>
      </Panel>

      {invoices.length === 0 ? (
        <EmptyState title="Nenhuma fatura gerada ainda" />
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
          {invoices.map((invoice) => {
            const overdue = isOverdue(invoice);
            const boundMarkPaid = markPaidAction.bind(null, id, invoice.id);
            const boundCancel = cancelInvoiceAction.bind(null, id, invoice.id);
            return (
              <li key={invoice.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                <div>
                  <div className="flex items-center gap-2">
                    <Badge tone={STATUS_TONE[invoice.status]}>{STATUS_LABEL[invoice.status]}</Badge>
                    {overdue && <Badge tone="critical">Vencida</Badge>}
                    <span className="font-medium text-ink">
                      {formatDate(invoice.periodStart)} – {formatDate(invoice.periodEnd)}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-ink-faint">
                    Vencimento {formatDate(invoice.dueDate)}
                    {invoice.paidAt ? ` · pago em ${formatDate(invoice.paidAt, tz)}` : ''}
                  </p>
                </div>

                <div className="flex items-center gap-3">
                  <span className="tabular-nums text-sm font-semibold text-ink">{currency.format(Number(invoice.totalDue))}</span>
                  <a
                    href={`/customers/${id}/invoices/${invoice.id}/pdf`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs font-medium text-ink-muted transition-colors hover:text-accent"
                  >
                    PDF
                  </a>
                  {invoice.status === 'PENDING' && (
                    <>
                      <form action={boundMarkPaid}>
                        <PlainSubmitButton
                          className="text-xs font-medium text-emerald-600 hover:underline dark:text-emerald-400"
                          pendingLabel="Marcando..."
                        >
                          Marcar como paga
                        </PlainSubmitButton>
                      </form>
                      <form action={boundCancel}>
                        <SubmitButton variant="danger" pendingLabel="Cancelando...">
                          Cancelar
                        </SubmitButton>
                      </form>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
