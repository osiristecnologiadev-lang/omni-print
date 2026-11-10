import Link from 'next/link';
import { ScrollHint } from '@/components/ScrollHint';
import { HelpTip } from '@/components/HelpTip';
import { forbidden } from 'next/navigation';
import { getViewerAccess, getContractsOverview, type ContractOverviewRow } from '@/lib/api';
import { hasPermission } from '@/lib/permissions';
import { PageHeader } from '@/components/PageHeader';
import { Panel } from '@/components/Panel';
import { EmptyState } from '@/components/EmptyState';
import { Badge, type BadgeTone } from '@/components/Badge';

const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const int = new Intl.NumberFormat('pt-BR');
const DAY = 24 * 60 * 60 * 1000;

// Period dates are calendar dates stored at UTC midnight.
function formatDate(iso: string | Date): string {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeZone: 'UTC' }).format(new Date(iso));
}

// The invoice of the current period is generated the day after it ends.
function closingDate(r: ContractOverviewRow): Date | null {
  return r.current ? new Date(new Date(r.current.periodEnd).getTime() + 1) : null;
}

function daysUntil(d: Date): number {
  return Math.ceil((d.getTime() - Date.now()) / DAY);
}

const INVOICE_STATUS: Record<string, { label: string; tone: BadgeTone }> = {
  PENDING: { label: 'em aberto', tone: 'warning' },
  PAID: { label: 'paga', tone: 'ok' },
  CANCELLED: { label: 'cancelada', tone: 'neutral' },
};

export default async function ClosingPage() {
  const access = await getViewerAccess();
  if (!hasPermission(access, 'contracts')) {
    forbidden();
  }
  const rows = (await getContractsOverview())
    .filter((r) => r.contract && r.current)
    .sort((a, b) => closingDate(a)!.getTime() - closingDate(b)!.getTime());

  const withIssues = rows.filter((r) => r.devicesToReview > 0 || r.devicesWithoutReading > 0);

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <PageHeader
        title="Fechamento do mês"
        subtitle="Quem fecha primeiro, quanto o período já soma e o que precisa ser resolvido antes da fatura sair. A fatura é gerada sozinha na madrugada seguinte ao fim do período de cada cliente."
      />

      {withIssues.length > 0 ? (
        <div className="mb-6 rounded-xl border border-amber-300 bg-amber-50 px-5 py-4 text-sm text-amber-900 dark:border-amber-700/60 dark:bg-amber-900/20 dark:text-amber-200">
          <p className="font-medium">
            {withIssues.length} cliente{withIssues.length === 1 ? '' : 's'} com pendência antes do fechamento
          </p>
          <p className="mt-1 text-xs">
            <strong>Sem leitura há 3+ dias:</strong> a impressora entra na fatura com a última leitura que existir - confira se o
            computador do agente e a impressora estão ligados. <strong>Para revisar:</strong> impressoras novas que ainda não
            entram na cobrança até alguém confirmar na página delas.
          </p>
        </div>
      ) : (
        rows.length > 0 && (
          <div className="mb-6 rounded-xl border border-line bg-surface px-5 py-4 text-sm text-ink-muted">
            Nenhuma pendência: todas as impressoras cobradas têm leitura recente e não há impressoras para revisar.
          </div>
        )
      )}

      <Panel>
        {rows.length === 0 ? (
          <EmptyState
            title="Nenhum contrato ativo"
            hint="O fechamento só existe para clientes com contrato."
            action={
              <Link href="/contracts" className="text-sm text-accent hover:underline">
                Ir para Contratos →
              </Link>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <ScrollHint />
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-ink-muted">
                  <th className="pb-2 pr-4 font-medium">Cliente</th>
                  <th className="pb-2 pr-4 font-medium">Próximo fechamento</th>
                  <th className="pb-2 pr-4 text-right font-medium">
                    Período até hoje
                    <HelpTip term="periodoAtual" placement="bottom" />
                  </th>
                  <th className="pb-2 pr-4 font-medium">
                    Pendências
                    <HelpTip term="semLeitura" placement="bottom" />
                  </th>
                  <th className="pb-2 pr-4 font-medium">Última fatura</th>
                  <th className="pb-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const close = closingDate(r)!;
                  const days = daysUntil(close);
                  const inv = r.lastInvoice;
                  return (
                    <tr key={r.customerId} className="border-b border-line align-top last:border-0">
                      <td className="py-3 pr-4">
                        <Link href={`/customers/${r.customerId}`} className="font-medium text-ink hover:text-accent">
                          {r.customerName}
                        </Link>
                        <div className="text-xs text-ink-faint">fecha todo dia {r.billingCycleDay}</div>
                      </td>
                      <td className="py-3 pr-4">
                        <div className="text-ink">{formatDate(close)}</div>
                        <div className={`text-xs ${days <= 3 ? 'font-medium text-amber-700 dark:text-amber-400' : 'text-ink-muted'}`}>
                          {days <= 0 ? 'hoje' : days === 1 ? 'amanhã' : `em ${days} dias`}
                        </div>
                      </td>
                      <td className="py-3 pr-4 text-right">
                        <div className="tabular-nums text-ink">{money.format(r.current!.totalDue)}</div>
                        <div className="text-xs text-ink-muted">
                          {int.format(r.current!.totalPages)} págs desde {formatDate(r.current!.periodStart)}
                        </div>
                      </td>
                      <td className="py-3 pr-4">
                        <div className="flex flex-col items-start gap-1">
                          {r.devicesWithoutReading > 0 && (
                            <Link href={`/customers/${r.customerId}?tab=impressoras`}>
                              <Badge tone="critical">{r.devicesWithoutReading} sem leitura há 3+ dias</Badge>
                            </Link>
                          )}
                          {r.devicesToReview > 0 && (
                            <Link href={`/customers/${r.customerId}?tab=impressoras`}>
                              <Badge tone="warning">{r.devicesToReview} para revisar</Badge>
                            </Link>
                          )}
                          {r.devicesWithoutReading === 0 && r.devicesToReview === 0 && <span className="text-xs text-ink-faint">nenhuma</span>}
                        </div>
                      </td>
                      <td className="py-3 pr-4">
                        {inv ? (
                          <>
                            <div className="text-ink">
                              nº {inv.number} · {money.format(Number(inv.totalDue))}
                            </div>
                            <div className="mt-0.5 flex items-center gap-2 text-xs text-ink-muted">
                              {formatDate(inv.periodStart)} a {formatDate(inv.periodEnd)}
                              <Badge tone={INVOICE_STATUS[inv.status].tone}>{INVOICE_STATUS[inv.status].label}</Badge>
                            </div>
                          </>
                        ) : (
                          <span className="text-xs text-ink-faint">nenhuma ainda</span>
                        )}
                      </td>
                      <td className="py-3 text-right whitespace-nowrap">
                        <Link href={`/customers/${r.customerId}/invoices`} className="text-sm text-accent hover:underline">
                          Faturas
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
    </main>
  );
}
