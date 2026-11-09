'use client';

import { useRef, useState } from 'react';
import type { ContractPricingModel } from '@/lib/api';
import { SubmitButton } from '@/components/SubmitButton';
import { HelpTip } from '@/components/HelpTip';
import { PRICING_MODEL_HELP } from '@/lib/contract-labels';
import { parseBRNumber } from '@/lib/br-number';

const inputClass =
  'mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none transition-colors focus:border-accent';

const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const int = new Intl.NumberFormat('pt-BR');

function Field({ label, hint, tip, children }: { label: string; hint?: string; tip?: string; children: React.ReactNode }) {
  return (
    <label className="text-xs text-ink-muted">
      {label}
      {tip && <HelpTip text={tip} />}
      {children}
      {hint && <span className="mt-1 block text-[11px] text-ink-faint">{hint}</span>}
    </label>
  );
}

type Sim = { lines: Array<[string, number]>; total: number } | null;

const n = (fd: FormData, k: string) => {
  const v = parseBRNumber(String(fd.get(k) ?? ''));
  return Number.isFinite(v) ? v : 0;
};

// Same rules as the API's ContractsService.calculateBilling, for a made-up
// month: total = taxa fixa + uso.
function simulate(model: ContractPricingModel, fd: FormData, mono: number, color: number, printers: number): Sim {
  const fixed = n(fd, 'fixedFee');
  const lines: Array<[string, number]> = [];
  if (fixed) lines.push([model === 'FLAT_RATE' ? 'Mensalidade' : model === 'ALLOWANCE_PLUS_OVERAGE' ? 'Mensalidade base' : 'Taxa fixa', fixed]);
  switch (model) {
    case 'FLAT_RATE':
      break;
    case 'ALLOWANCE_PLUS_OVERAGE': {
      const exMono = Math.max(0, mono - n(fd, 'includedPagesMono'));
      const exColor = Math.max(0, color - n(fd, 'includedPagesColor'));
      lines.push([`Excedente P&B: ${int.format(exMono)} págs`, exMono * n(fd, 'overagePriceMono')]);
      lines.push([`Excedente cor: ${int.format(exColor)} págs`, exColor * n(fd, 'overagePriceColor')]);
      break;
    }
    case 'PER_PAGE': {
      const bMono = Math.max(n(fd, 'minimumPagesMono'), mono);
      const bColor = Math.max(n(fd, 'minimumPagesColor'), color);
      lines.push([`P&B: ${int.format(bMono)} págs${bMono > mono ? ' (mínimo)' : ''}`, bMono * n(fd, 'pricePerPageMono')]);
      lines.push([`Cor: ${int.format(bColor)} págs${bColor > color ? ' (mínimo)' : ''}`, bColor * n(fd, 'pricePerPageColor')]);
      break;
    }
    case 'PER_DEVICE_MINIMUM': {
      const p = Math.max(1, Math.round(printers));
      const each = (mono / p) * n(fd, 'pricePerPageMono') + (color / p) * n(fd, 'pricePerPageColor');
      const min = n(fd, 'minimumChargePerDevice');
      const charge = Math.max(each, min);
      lines.push([`${p} impressora(s) × ${money.format(charge)}${min > each ? ' (mínimo)' : ' (uso)'}`, charge * p]);
      break;
    }
  }
  return { lines, total: lines.reduce((s, [, v]) => s + v, 0) };
}

export function ContractForm({
  action,
  isRenegotiate,
  printers = 1,
}: {
  action: (formData: FormData) => void;
  isRenegotiate: boolean;
  // How many printers this customer bills today - the simulation's default.
  printers?: number;
}) {
  const [model, setModel] = useState<ContractPricingModel>('ALLOWANCE_PLUS_OVERAGE');
  const formRef = useRef<HTMLFormElement>(null);
  const [simMono, setSimMono] = useState('10000');
  const [simColor, setSimColor] = useState('500');
  const [simPrinters, setSimPrinters] = useState(String(Math.max(1, printers)));
  const [sim, setSim] = useState<Sim>(null);

  function recalc(next?: { model?: ContractPricingModel; mono?: string; color?: string; printers?: string }) {
    if (!formRef.current) return;
    setSim(
      simulate(
        next?.model ?? model,
        new FormData(formRef.current),
        parseBRNumber(next?.mono ?? simMono) || 0,
        parseBRNumber(next?.color ?? simColor) || 0,
        parseBRNumber(next?.printers ?? simPrinters) || 1,
      ),
    );
  }

  return (
    <form ref={formRef} action={action} onChange={() => recalc()} className="space-y-4">
      <div>
        <label className="text-xs text-ink-muted">Modelo de cobrança</label>
        <select
          name="pricingModel"
          value={model}
          onChange={(e) => {
            const m = e.target.value as ContractPricingModel;
            setModel(m);
            // Fields change with the model - recalc after they render.
            setTimeout(() => recalc({ model: m }), 0);
          }}
          className={inputClass}
        >
          <option value="ALLOWANCE_PLUS_OVERAGE">Franquia com excedente</option>
          <option value="PER_PAGE">Por página com mínimo</option>
          <option value="PER_DEVICE_MINIMUM">Mínimo por impressora</option>
          <option value="FLAT_RATE">Mensalidade fixa</option>
        </select>
        <p className="mt-1 text-xs text-ink-faint">{PRICING_MODEL_HELP[model]}</p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Data de início" hint="Primeiro dia que este contrato cobra. Em renegociação, o contrato anterior termina na véspera.">
          <input type="date" name="startDate" required className={inputClass} />
        </Field>
        <Field label="Data de término (opcional)" hint="Deixe vazio para contrato sem prazo.">
          <input type="date" name="endDate" className={inputClass} />
        </Field>
        <Field
          label="Dia de vencimento"
          hint="Dia do mês em que a fatura vence. Não muda o período de leitura - esse é o dia de fechamento, nas configurações do cliente."
        >
          <input type="number" name="billingDay" min={1} max={31} defaultValue={10} required className={inputClass} />
        </Field>

        {model === 'PER_PAGE' || model === 'PER_DEVICE_MINIMUM' ? (
          <Field label="Taxa fixa adicional (opcional)" hint="Valor somado à fatura todo mês, além das páginas. Ex.: aluguel do equipamento.">
            <input type="text" inputMode="decimal" name="fixedFee" placeholder="0,00" className={inputClass} />
          </Field>
        ) : (
          <Field
            label={model === 'FLAT_RATE' ? 'Mensalidade (R$)' : 'Mensalidade base (R$)'}
            hint={model === 'FLAT_RATE' ? 'Valor cobrado todo mês, imprima o quanto imprimir.' : 'Valor do mês que já inclui a franquia de páginas abaixo.'}
          >
            <input type="text" inputMode="decimal" name="fixedFee" required placeholder="450,00" className={inputClass} />
          </Field>
        )}

        {model === 'ALLOWANCE_PLUS_OVERAGE' && (
          <>
            <Field label="Franquia P&B (páginas)" tip="Páginas P&B que a mensalidade já cobre." hint="Ex.: 5.000">
              <input type="number" name="includedPagesMono" min={0} required placeholder="5000" className={inputClass} />
            </Field>
            <Field label="Franquia cor (páginas)" tip="Páginas coloridas que a mensalidade já cobre." hint="Ex.: 500 (0 se não tem colorida)">
              <input type="number" name="includedPagesColor" min={0} required placeholder="500" className={inputClass} />
            </Field>
            <Field label="Excedente P&B (R$/página)" tip="Preço de cada página P&B além da franquia." hint="Ex.: 0,08">
              <input type="text" inputMode="decimal" name="overagePriceMono" required placeholder="0,08" className={inputClass} />
            </Field>
            <Field label="Excedente cor (R$/página)" tip="Preço de cada página colorida além da franquia." hint="Ex.: 0,35">
              <input type="text" inputMode="decimal" name="overagePriceColor" required placeholder="0,35" className={inputClass} />
            </Field>
          </>
        )}

        {model === 'PER_PAGE' && (
          <>
            <Field label="Preço por página P&B (R$)" hint="Aceita até 6 casas. Ex.: 0,04725">
              <input type="text" inputMode="decimal" name="pricePerPageMono" required placeholder="0,03" className={inputClass} />
            </Field>
            <Field
              label="Preço por página cor (R$)"
              hint="Uma impressora pode ter preço colorido próprio, na página dela."
            >
              <input type="text" inputMode="decimal" name="pricePerPageColor" required placeholder="0,12" className={inputClass} />
            </Field>
            <Field
              label="Mínimo garantido P&B (páginas)"
              tip="Se o cliente imprimir menos que isso no mês, cobra este número de páginas mesmo assim."
              hint="0 = sem mínimo"
            >
              <input type="number" name="minimumPagesMono" min={0} required placeholder="500" className={inputClass} />
            </Field>
            <Field label="Mínimo garantido cor (páginas)" hint="0 = sem mínimo">
              <input type="number" name="minimumPagesColor" min={0} required placeholder="0" className={inputClass} />
            </Field>
          </>
        )}

        {model === 'PER_DEVICE_MINIMUM' && (
          <>
            <Field label="Preço por página P&B (R$)" hint="Aceita até 6 casas. Ex.: 0,042">
              <input type="text" inputMode="decimal" name="pricePerPageMono" required placeholder="0,042" className={inputClass} />
            </Field>
            <Field label="Preço por página cor (R$)" hint="Uma impressora pode ter preço colorido próprio, na página dela.">
              <input type="text" inputMode="decimal" name="pricePerPageColor" required placeholder="0,042" className={inputClass} />
            </Field>
            <Field
              label="Mínimo por impressora (R$)"
              tip="Cada impressora paga no mínimo este valor. Se as páginas × preço dela passarem disso, paga o uso."
              hint="Ex.: 200,00. Uma impressora pode ter mínimo próprio, na página dela."
            >
              <input type="text" inputMode="decimal" name="minimumChargePerDevice" required placeholder="200,00" className={inputClass} />
            </Field>
          </>
        )}

        <Field label="Taxa de instalação (opcional)" hint="Só registro - não entra nas faturas mensais.">
          <input type="text" inputMode="decimal" name="setupFee" placeholder="0,00" className={inputClass} />
        </Field>
        <Field label="Multa rescisória (opcional)" hint="Só registro - não é cobrada automaticamente.">
          <input type="text" inputMode="decimal" name="earlyTerminationFee" placeholder="0,00" className={inputClass} />
        </Field>
        <Field label="Índice de reajuste (opcional)" hint="Só registro. Ex.: IPCA, IGP-M.">
          <input type="text" name="adjustmentIndex" placeholder="IPCA" className={inputClass} />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Observações">
            <textarea name="notes" rows={2} className={inputClass} />
          </Field>
        </div>
      </div>

      <div className="rounded-xl border border-line bg-surface-2 p-4">
        <p className="text-sm font-medium text-ink">Simulação</p>
        <p className="mt-0.5 text-xs text-ink-muted">Quanto daria a fatura de um mês com estas quantidades - muda enquanto você preenche.</p>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="text-xs text-ink-muted">
            Páginas P&B no mês
            <input
              type="text"
              inputMode="numeric"
              value={simMono}
              onChange={(e) => {
                setSimMono(e.target.value);
                recalc({ mono: e.target.value });
              }}
              className={`${inputClass} w-32`}
            />
          </label>
          <label className="text-xs text-ink-muted">
            Páginas cor no mês
            <input
              type="text"
              inputMode="numeric"
              value={simColor}
              onChange={(e) => {
                setSimColor(e.target.value);
                recalc({ color: e.target.value });
              }}
              className={`${inputClass} w-32`}
            />
          </label>
          {model === 'PER_DEVICE_MINIMUM' && (
            <label className="text-xs text-ink-muted">
              Impressoras
              <input
                type="text"
                inputMode="numeric"
                value={simPrinters}
                onChange={(e) => {
                  setSimPrinters(e.target.value);
                  recalc({ printers: e.target.value });
                }}
                className={`${inputClass} w-24`}
              />
            </label>
          )}
        </div>
        {sim ? (
          <dl className="mt-3 space-y-1 text-sm">
            {sim.lines.map(([label, value]) => (
              <div key={label} className="flex justify-between gap-4 text-ink-muted">
                <dt>{label}</dt>
                <dd className="tabular-nums">{money.format(value)}</dd>
              </div>
            ))}
            <div className="flex justify-between gap-4 border-t border-line pt-1 font-medium text-ink">
              <dt>Total do mês</dt>
              <dd className="tabular-nums">{money.format(sim.total)}</dd>
            </div>
          </dl>
        ) : (
          <p className="mt-3 text-xs text-ink-faint">Preencha os valores do contrato para ver a simulação.</p>
        )}
        {model === 'PER_DEVICE_MINIMUM' && (
          <p className="mt-2 text-[11px] text-ink-faint">
            A simulação divide as páginas igualmente entre as impressoras. Na fatura real, cada uma é calculada com as próprias páginas.
          </p>
        )}
      </div>

      <SubmitButton variant="primary" pendingLabel="Salvando...">
        {isRenegotiate ? 'Renegociar' : 'Criar contrato'}
      </SubmitButton>
    </form>
  );
}
