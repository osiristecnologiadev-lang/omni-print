import Link from 'next/link';
import { ScrollHint } from '@/components/ScrollHint';
import { HelpTip } from '@/components/HelpTip';
import { forbidden } from 'next/navigation';
import { getViewerAccess, getContractsOverview } from '@/lib/api';
import { hasPermission } from '@/lib/permissions';
import { PageHeader } from '@/components/PageHeader';
import { Panel } from '@/components/Panel';
import { EmptyState } from '@/components/EmptyState';
import { Badge } from '@/components/Badge';
import { PRICING_MODEL_HELP, PRICING_MODEL_LABEL, contractPriceSummary } from '@/lib/contract-labels';

const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const int = new Intl.NumberFormat('pt-BR');

// Contract and period dates are calendar dates stored at UTC midnight.
function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeZone: 'UTC' }).format(new Date(iso));
}

function Tile({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface px-5 py-4">
      <p className="text-xs font-medium text-ink-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-ink">{value}</p>
      <p className="mt-1 text-[11px] text-ink-faint">{hint}</p>
    </div>
  );
}

export default async function ContractsPage() {
  const access = await getViewerAccess();
  if (!hasPermission(access, 'contracts')) {
    forbidden();
  }
  const rows = await getContractsOverview();

  const withContract = rows.filter((r) => r.contract);
  const without = rows.filter((r) => !r.contract);
  const accrued = withContract.reduce((sum, r) => sum + (r.current?.totalDue ?? 0), 0);
  const toReview = rows.reduce((sum, r) => sum + r.devicesToReview, 0);

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <PageHeader
        title="Contratos"
        subtitle="Os contratos de todos os seus clientes numa tela só: como cada um é cobrado, desde quando, quantas impressoras entram na conta e quanto o mês atual já soma."
      />

      <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile label="Contratos ativos" value={int.format(withContract.length)} hint="Clientes que já são cobrados" />
        <Tile label="Clientes sem contrato" value={int.format(without.length)} hint="Monitorados, mas nada é cobrado" />
        <Tile label="Previsto no período" value={money.format(accrued)} hint="Soma até hoje, de todos os contratos" />
        <Tile label="Impressoras para revisar" value={int.format(toReview)} hint="Novas, ainda fora da cobrança" />
      </div>

      <Panel>
        {rows.length === 0 ? (
          <EmptyState
            title="Nenhum cliente cadastrado ainda"
            hint="Cadastre um cliente para poder criar o contrato dele."
            action={
              <Link href="/customers" className="text-sm text-accent hover:underline">
                Ir para Clientes →
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
                  <th className="pb-2 pr-4 font-medium">Como é cobrado</th>
                  <th className="pb-2 pr-4 font-medium">Vigência</th>
                  <th className="pb-2 pr-4 font-medium">
                    Fecha dia
                    <HelpTip term="diaFechamento" placement="bottom" />
                  </th>
                  <th className="pb-2 pr-4 font-medium">
                    Impressoras
                    <HelpTip term="foraDoContrato" placement="bottom" />
                  </th>
                  <th className="pb-2 pr-4 text-right font-medium">
                    Período atual (até hoje)
                    <HelpTip term="periodoAtual" placement="bottom" />
                  </th>
                  <th className="pb-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.customerId} className="border-b border-line align-top last:border-0">
                    <td className="py-3 pr-4">
                      <Link href={`/customers/${r.customerId}`} className="font-medium text-ink hover:text-accent">
                        {r.customerName}
                      </Link>
                    </td>
                    <td className="py-3 pr-4">
                      {r.contract ? (
                        <>
                          <div className="text-ink">
                            {PRICING_MODEL_LABEL[r.contract.pricingModel]}
                            <HelpTip text={PRICING_MODEL_HELP[r.contract.pricingModel]} placement="bottom" />
                          </div>
                          <div className="mt-0.5 text-xs text-ink-muted">{contractPriceSummary(r.contract)}</div>
                        </>
                      ) : (
                        <Badge tone="neutral">Sem contrato</Badge>
                      )}
                    </td>
                    <td className="py-3 pr-4 text-ink-muted">
                      {r.contract ? (
                        <>
                          desde {formatDate(r.contract.startDate)}
                          {r.contract.endDate && <div className="text-xs">até {formatDate(r.contract.endDate)}</div>}
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="py-3 pr-4 tabular-nums text-ink-muted">{r.billingCycleDay}</td>
                    <td className="py-3 pr-4 text-ink-muted">
                      <span className="tabular-nums text-ink">{r.devicesBilled}</span> {r.devicesBilled === 1 ? 'cobrada' : 'cobradas'}
                      {r.devicesExcluded > 0 && <div className="text-xs">{r.devicesExcluded} fora do contrato</div>}
                      {r.devicesToReview > 0 && (
                        <div className="mt-1">
                          <Badge tone="warning">{r.devicesToReview} para revisar</Badge>
                        </div>
                      )}
                    </td>
                    <td className="py-3 pr-4 text-right">
                      {r.current ? (
                        <>
                          <div className="tabular-nums text-ink">{money.format(r.current.totalDue)}</div>
                          <div className="text-xs text-ink-muted">
                            {int.format(r.current.totalPages)} págs · {formatDate(r.current.periodStart)} a {formatDate(r.current.periodEnd)}
                          </div>
                        </>
                      ) : (
                        <span className="text-ink-faint">—</span>
                      )}
                    </td>
                    <td className="py-3 text-right whitespace-nowrap">
                      <Link href={`/customers/${r.customerId}/contract`} className="text-sm text-accent hover:underline">
                        {r.contract ? 'Ver / editar' : 'Criar contrato'}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <p className="mt-4 text-xs text-ink-faint">
        <strong className="font-medium text-ink-muted">Como ler:</strong> &ldquo;Período atual&rdquo; é o que a fatura daria se
        fechasse hoje - ela é gerada de verdade no dia de fechamento de cada cliente. Impressoras &ldquo;fora do contrato&rdquo;
        continuam monitoradas, mas não entram na conta. O &ldquo;?&rdquo; ao lado de cada tipo de cobrança explica como ele funciona.
      </p>
    </main>
  );
}
