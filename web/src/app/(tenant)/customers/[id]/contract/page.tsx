import Link from 'next/link';
import { forbidden } from 'next/navigation';
import {
  getActiveContract,
  getBilling,
  getContracts,
  getCustomer,
  getSession,
  type Contract,
} from '@/lib/api';
import { createContractAction, cancelContractAction } from './actions';
import { ContractForm } from './ContractForm';
import { PageHeader } from '@/components/PageHeader';
import { Panel, PanelSection } from '@/components/Panel';
import { Button } from '@/components/Button';
import { SubmitButton } from '@/components/SubmitButton';
import { Banner } from '@/components/Banner';
import { Badge, type BadgeTone } from '@/components/Badge';

const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const integer = new Intl.NumberFormat('pt-BR');
// Per-page prices/rates, unlike totals, are commonly negotiated down to
// fractions of a cent in this market (e.g. R$0,042/página at real print
// volumes) - currency's fixed 2-decimal formatting silently rounds those
// to R$0,04 for display (the stored value and the actual billing math are
// unaffected either way, both use the full Decimal(12,4) precision - this
// was purely a display bug, reported directly by a real contract). Only
// pads to 2 decimals when the rate doesn't need more (R$0,08 still shows
// as "R$ 0,08", not "R$ 0,0800").
const rate = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 4 });

// Contract.startDate/endDate are calendar dates (picked via <input
// type="date">, stored as UTC midnight) - timeZone: 'UTC' here is
// deliberate, not a bug, same reasoning as dashboard's formatUtcDate:
// converting to the viewer's own timezone could shift the displayed day.
function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeZone: 'UTC' }).format(new Date(iso));
}

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: 'Ativo',
  SUSPENDED: 'Suspenso',
  CANCELLED: 'Cancelado',
  EXPIRED: 'Expirado',
};

const STATUS_TONE: Record<string, BadgeTone> = {
  ACTIVE: 'ok',
  SUSPENDED: 'warning',
  CANCELLED: 'neutral',
  EXPIRED: 'neutral',
};

const MODEL_LABEL: Record<string, string> = {
  FLAT_RATE: 'Mensalidade fixa',
  ALLOWANCE_PLUS_OVERAGE: 'Franquia com excedente',
  PER_PAGE: 'Por página com mínimo',
};

function ContractTerms({ contract }: { contract: Contract }) {
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
      <div className="col-span-2 sm:col-span-3">
        <dt className="text-xs text-ink-faint">Modelo</dt>
        <dd className="font-medium text-ink">{MODEL_LABEL[contract.pricingModel]}</dd>
      </div>

      {contract.fixedFee != null && (
        <div>
          <dt className="text-xs text-ink-faint">
            {contract.pricingModel === 'PER_PAGE' ? 'Taxa fixa adicional' : 'Mensalidade'}
          </dt>
          <dd className="tabular-nums text-ink-muted">{currency.format(Number(contract.fixedFee))}</dd>
        </div>
      )}

      {contract.pricingModel === 'ALLOWANCE_PLUS_OVERAGE' && (
        <>
          <div>
            <dt className="text-xs text-ink-faint">Franquia P&B</dt>
            <dd className="tabular-nums text-ink-muted">{integer.format(contract.includedPagesMono ?? 0)} pág.</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-faint">Franquia cor</dt>
            <dd className="tabular-nums text-ink-muted">{integer.format(contract.includedPagesColor ?? 0)} pág.</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-faint">Excedente P&B</dt>
            <dd className="tabular-nums text-ink-muted">{rate.format(Number(contract.overagePriceMono ?? 0))}/pág.</dd>
          </div>
        </>
      )}

      {contract.pricingModel === 'PER_PAGE' && (
        <>
          <div>
            <dt className="text-xs text-ink-faint">Preço por página P&B</dt>
            <dd className="tabular-nums text-ink-muted">{rate.format(Number(contract.pricePerPageMono ?? 0))}</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-faint">Mínimo garantido P&B</dt>
            <dd className="tabular-nums text-ink-muted">{integer.format(contract.minimumPagesMono ?? 0)} pág.</dd>
          </div>
        </>
      )}

      <div>
        <dt className="text-xs text-ink-faint">Vencimento</dt>
        <dd className="text-ink-muted">dia {contract.billingDay}</dd>
      </div>
      <div>
        <dt className="text-xs text-ink-faint">Início</dt>
        <dd className="text-ink-muted">{formatDate(contract.startDate)}</dd>
      </div>
      {contract.adjustmentIndex && (
        <div>
          <dt className="text-xs text-ink-faint">Reajuste</dt>
          <dd className="text-ink-muted">{contract.adjustmentIndex}</dd>
        </div>
      )}
      {contract.notes && (
        <div className="col-span-2 sm:col-span-3">
          <dt className="text-xs text-ink-faint">Observações</dt>
          <dd className="text-ink-muted">{contract.notes}</dd>
        </div>
      )}
    </dl>
  );
}

function StatTile({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={`rounded-lg p-3 ${accent ? 'bg-accent-soft' : 'bg-surface-2'}`}>
      <p className={`text-xs ${accent ? 'text-accent' : 'text-ink-faint'}`}>{label}</p>
      <p className={`text-lg font-semibold tabular-nums ${accent ? 'text-accent' : 'text-ink'}`}>{value}</p>
    </div>
  );
}

export default async function ContractPage(props: PageProps<'/customers/[id]/contract'>) {
  const { id } = await props.params;
  const searchParams = await props.searchParams;

  const session = await getSession();
  if (session?.customerId) {
    forbidden();
  }

  const now = new Date();
  const year = Number(searchParams?.year) || now.getFullYear();
  const month = Number(searchParams?.month) || now.getMonth() + 1;

  const [customer, active, history, billing] = await Promise.all([
    getCustomer(id),
    getActiveContract(id),
    getContracts(id),
    getBilling(id, year, month),
  ]);

  const monthOptions = Array.from({ length: 12 }, (_, i) => i + 1);
  const yearOptions = [now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1];
  const boundCreate = createContractAction.bind(null, id);
  const boundCancel = cancelContractAction.bind(null, id);
  const selectClass =
    'rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-ink outline-none transition-colors focus:border-accent';

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <PageHeader
        title="Contrato"
        subtitle={`Termos comerciais entre você e ${customer.name}, e o cálculo automático do valor devido a partir das páginas realmente impressas.`}
        back={{ href: `/customers/${id}`, label: customer.name }}
        actions={
          <Link href={`/customers/${id}/invoices`} className="text-sm text-ink-muted transition-colors hover:text-accent">
            Ver faturas →
          </Link>
        }
      />

      {searchParams?.saved === '1' && <Banner tone="success">Contrato salvo.</Banner>}
      {searchParams?.error === '1' && (
        <Banner tone="error">Não foi possível salvar o contrato. Confira os valores e tente novamente.</Banner>
      )}
      {searchParams?.cancelled === '1' && <Banner tone="success">Contrato cancelado.</Banner>}
      {searchParams?.cancelError === '1' && <Banner tone="error">Não foi possível cancelar o contrato. Tente novamente.</Banner>}

      {/* --- Active contract --- */}
      <Panel>
        <h2 className="mb-3 text-sm font-medium text-ink">Contrato ativo</h2>
        {active ? (
          <ContractTerms contract={active} />
        ) : (
          <p className="text-sm text-ink-faint">Nenhum contrato ativo — cadastre um abaixo.</p>
        )}
        {active && (
          <form action={boundCancel.bind(null, active.id)} className="mt-4">
            <SubmitButton variant="danger" pendingLabel="Cancelando...">
              Cancelar contrato
            </SubmitButton>
          </form>
        )}
      </Panel>

      {/* --- Billing calculator --- */}
      <Panel className="mt-6">
        <h2 className="mb-1 text-sm font-medium text-ink">Fatura do período</h2>
        <p className="mb-4 text-xs text-ink-faint">
          Calculado a partir do contador real de páginas de cada impressora do cliente.
        </p>

        <form method="get" className="mb-4 flex items-center gap-2">
          <select name="month" defaultValue={month} className={selectClass}>
            {monthOptions.map((m) => (
              <option key={m} value={m}>
                {new Intl.DateTimeFormat('pt-BR', { month: 'long' }).format(new Date(2000, m - 1, 1))}
              </option>
            ))}
          </select>
          <select name="year" defaultValue={year} className={selectClass}>
            {yearOptions.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
          <Button type="submit" variant="secondary">
            Calcular
          </Button>
        </form>

        {!billing.hasContract ? (
          <p className="rounded-lg border border-dashed border-line p-4 text-sm text-ink-faint">
            Nenhum contrato vigente nesse período.
          </p>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatTile label="Páginas no período" value={integer.format(billing.totalPages)} />
              {billing.contract.pricingModel === 'ALLOWANCE_PLUS_OVERAGE' && (
                <>
                  <StatTile label="Franquia" value={integer.format(billing.includedTotal ?? 0)} />
                  <StatTile label="Excedente" value={integer.format(billing.overagePages ?? 0)} />
                </>
              )}
              {billing.contract.pricingModel === 'PER_PAGE' && (
                <>
                  <StatTile label="Mínimo garantido" value={integer.format(billing.minimumPages ?? 0)} />
                  <StatTile label="Faturadas" value={integer.format(billing.billablePages ?? 0)} />
                </>
              )}
              <StatTile label="Total devido" value={currency.format(billing.totalDue)} accent />
            </div>

            <p className="text-xs text-ink-faint">
              {MODEL_LABEL[billing.contract.pricingModel]}: {currency.format(billing.fixedFee)} de taxa fixa +{' '}
              {currency.format(billing.usageCost)} de uso = {currency.format(billing.totalDue)}.
              {billing.contract.pricingModel !== 'FLAT_RATE' &&
                billing.colorPages === 0 &&
                ' Nenhum dispositivo deste cliente reporta contagem separada de páginas coloridas ainda, então tudo foi cobrado à taxa P&B.'}
            </p>
            {billing.contract.pricingModel !== 'FLAT_RATE' && billing.colorPages > 0 && (
              <p className="text-xs text-ink-faint">
                P&B: {integer.format(billing.monoPages)} pág. · Cor: {integer.format(billing.colorPages)} pág.
              </p>
            )}

            <details className="text-sm">
              <summary className="cursor-pointer text-ink-muted">Ver por dispositivo ({billing.perDevice.length})</summary>
              <ul className="mt-2 divide-y divide-line">
                {billing.perDevice.map((d) => (
                  <li key={d.deviceId} className="flex justify-between py-1.5">
                    <span className="text-ink-muted">
                      {d.deviceName}
                      {d.counterReset && (
                        <span
                          title={
                            d.usedFallbackForReset
                              ? 'O contador de páginas impressas reiniciou durante o período - esse trecho foi calculado pelo contador do mecanismo.'
                              : 'Contador reiniciado durante o período - páginas já recalculadas corretamente.'
                          }
                          className="ml-1 text-amber-600 dark:text-amber-400"
                        >
                          *
                        </span>
                      )}
                      {d.usedManualBaseline && (
                        <span
                          title="Leitura anterior informada manualmente - monitoramento começou depois do início do período."
                          className="ml-1 text-accent"
                        >
                          †
                        </span>
                      )}
                    </span>
                    <span className="text-right">
                      <span className="tabular-nums text-ink-faint">{integer.format(d.pages)} pág.</span>
                      {d.enginePages !== d.pages && (
                        <span className="block text-xs text-ink-faint">mecanismo: {integer.format(d.enginePages)}</span>
                      )}
                      {billing.contract.pricingModel !== 'FLAT_RATE' && (
                        <span className="block text-xs tabular-nums text-ink-faint">
                          ≈ {currency.format(d.usageRevenue)} de receita
                        </span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
              {billing.contract.pricingModel !== 'FLAT_RATE' && (
                <p className="mt-2 text-xs text-ink-faint">
                  Receita estimada: rateio proporcional pelo uso de cada impressora, não um valor cobrado por
                  dispositivo (nenhum dos modelos de cobrança fatura por impressora individualmente).
                </p>
              )}
              {billing.contract.pricingModel === 'FLAT_RATE' && (
                <p className="mt-2 text-xs text-ink-faint">
                  Mensalidade fixa - não é possível atribuir receita a um dispositivo específico neste modelo.
                </p>
              )}
            </details>
          </div>
        )}
      </Panel>

      {/* --- New / renegotiate contract --- */}
      <Panel className="mt-6">
        <h2 className="mb-1 text-sm font-medium text-ink">{active ? 'Renegociar contrato' : 'Novo contrato'}</h2>
        <p className="mb-4 text-xs text-ink-faint">
          {active
            ? 'Cadastrar aqui encerra o contrato atual na data de início do novo, mantendo o histórico.'
            : 'Defina os termos comerciais deste cliente.'}
        </p>

        <ContractForm action={boundCreate} isRenegotiate={!!active} />
      </Panel>

      {/* --- History --- */}
      {history.length > 0 && (
        <PanelSection title="Histórico" className="mt-6">
          <ul className="divide-y divide-line">
            {history.map((c) => (
              <li key={c.id} className="flex items-center justify-between px-5 py-3 text-sm">
                <div>
                  <span className="mr-2">
                    <Badge tone={STATUS_TONE[c.status]}>{STATUS_LABEL[c.status]}</Badge>
                  </span>
                  <span className="text-ink-muted">
                    {MODEL_LABEL[c.pricingModel]} · {formatDate(c.startDate)} — {c.endDate ? formatDate(c.endDate) : 'atual'}
                  </span>
                </div>
                <span className="tabular-nums text-ink-faint">
                  {c.fixedFee != null ? `${currency.format(Number(c.fixedFee))}/mês` : '—'}
                </span>
              </li>
            ))}
          </ul>
        </PanelSection>
      )}
    </main>
  );
}
