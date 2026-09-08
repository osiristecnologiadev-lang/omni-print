'use client';

import { useState } from 'react';
import type { ContractPricingModel } from '@/lib/api';
import { SubmitButton } from '@/components/SubmitButton';

const inputClass =
  'mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none transition-colors focus:border-accent';

const MODEL_HELP: Record<ContractPricingModel, string> = {
  FLAT_RATE: 'Valor fixo por mês, independente da quantidade de páginas impressas.',
  ALLOWANCE_PLUS_OVERAGE: 'Mensalidade já inclui um pacote de páginas; o que passar disso é cobrado à parte.',
  PER_PAGE: 'Cobra por página impressa, mas nunca abaixo do valor equivalente à quantidade mínima garantida.',
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="text-xs text-ink-muted">
      {label}
      {children}
    </label>
  );
}

export function ContractForm({
  action,
  isRenegotiate,
}: {
  action: (formData: FormData) => void;
  isRenegotiate: boolean;
}) {
  const [model, setModel] = useState<ContractPricingModel>('ALLOWANCE_PLUS_OVERAGE');

  return (
    <form action={action} className="space-y-4">
      <div>
        <label className="text-xs text-ink-muted">Modelo de cobrança</label>
        <select
          name="pricingModel"
          value={model}
          onChange={(e) => setModel(e.target.value as ContractPricingModel)}
          className={inputClass}
        >
          <option value="ALLOWANCE_PLUS_OVERAGE">Franquia com excedente</option>
          <option value="PER_PAGE">Por página com mínimo</option>
          <option value="FLAT_RATE">Mensalidade fixa</option>
        </select>
        <p className="mt-1 text-xs text-ink-faint">{MODEL_HELP[model]}</p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Data de início">
          <input type="date" name="startDate" required className={inputClass} />
        </Field>
        <Field label="Data de término (opcional)">
          <input type="date" name="endDate" className={inputClass} />
        </Field>
        <Field label="Dia de vencimento">
          <input type="number" name="billingDay" min={1} max={31} defaultValue={10} required className={inputClass} />
        </Field>

        {model === 'PER_PAGE' ? (
          <Field label="Taxa fixa adicional (opcional)">
            <input type="text" inputMode="decimal" name="fixedFee" placeholder="0,00" className={inputClass} />
          </Field>
        ) : (
          <Field label={model === 'FLAT_RATE' ? 'Mensalidade (R$)' : 'Mensalidade base (R$)'}>
            <input type="text" inputMode="decimal" name="fixedFee" required placeholder="450,00" className={inputClass} />
          </Field>
        )}

        {model === 'ALLOWANCE_PLUS_OVERAGE' && (
          <>
            <Field label="Franquia P&B (páginas)">
              <input type="number" name="includedPagesMono" min={0} required placeholder="5000" className={inputClass} />
            </Field>
            <Field label="Franquia cor (páginas)">
              <input type="number" name="includedPagesColor" min={0} required placeholder="500" className={inputClass} />
            </Field>
            <Field label="Excedente P&B (R$/página)">
              <input type="text" inputMode="decimal" name="overagePriceMono" required placeholder="0,08" className={inputClass} />
            </Field>
            <Field label="Excedente cor (R$/página)">
              <input type="text" inputMode="decimal" name="overagePriceColor" required placeholder="0,35" className={inputClass} />
            </Field>
          </>
        )}

        {model === 'PER_PAGE' && (
          <>
            <Field label="Preço por página P&B (R$)">
              <input type="text" inputMode="decimal" name="pricePerPageMono" required placeholder="0,03" className={inputClass} />
            </Field>
            <Field label="Preço por página cor (R$)">
              <input type="text" inputMode="decimal" name="pricePerPageColor" required placeholder="0,12" className={inputClass} />
            </Field>
            <Field label="Mínimo garantido P&B (páginas)">
              <input type="number" name="minimumPagesMono" min={0} required placeholder="500" className={inputClass} />
            </Field>
            <Field label="Mínimo garantido cor (páginas)">
              <input type="number" name="minimumPagesColor" min={0} required placeholder="0" className={inputClass} />
            </Field>
          </>
        )}

        <Field label="Taxa de instalação (opcional)">
          <input type="text" inputMode="decimal" name="setupFee" placeholder="0,00" className={inputClass} />
        </Field>
        <Field label="Multa rescisória (opcional)">
          <input type="text" inputMode="decimal" name="earlyTerminationFee" placeholder="0,00" className={inputClass} />
        </Field>
        <Field label="Índice de reajuste (opcional)">
          <input type="text" name="adjustmentIndex" placeholder="IPCA" className={inputClass} />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Observações">
            <textarea name="notes" rows={2} className={inputClass} />
          </Field>
        </div>
      </div>

      <SubmitButton variant="primary" pendingLabel="Salvando...">
        {isRenegotiate ? 'Renegociar' : 'Criar contrato'}
      </SubmitButton>
    </form>
  );
}
