import type { Contract, ContractPricingModel } from '@/lib/api';

// Plain-language names and one-line explanations of each billing model -
// shared by the Contratos list and the contract form so they never drift.
export const PRICING_MODEL_LABEL: Record<ContractPricingModel, string> = {
  ALLOWANCE_PLUS_OVERAGE: 'Franquia com excedente',
  PER_PAGE: 'Por página com mínimo',
  PER_DEVICE_MINIMUM: 'Mínimo por impressora',
  FLAT_RATE: 'Mensalidade fixa',
};

export const PRICING_MODEL_HELP: Record<ContractPricingModel, string> = {
  ALLOWANCE_PLUS_OVERAGE: 'Mensalidade que já inclui um pacote de páginas; o que passar do pacote é cobrado por página.',
  PER_PAGE: 'Cobra cada página impressa, com um mínimo de páginas por mês.',
  PER_DEVICE_MINIMUM: 'Cobra cada página impressa, mas cada impressora paga pelo menos um valor mínimo no mês.',
  FLAT_RATE: 'Valor fixo por mês, não importa quantas páginas forem impressas.',
};

const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const rate = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 6 });
const int = new Intl.NumberFormat('pt-BR');

const m = (v: string | null) => money.format(Number(v ?? 0));
const r = (v: string | null) => rate.format(Number(v ?? 0));

// The contract's prices in one line, e.g. "P&B R$ 0,042 · cor R$ 0,042 por página · mínimo R$ 200,00 por impressora".
export function contractPriceSummary(c: Contract): string {
  switch (c.pricingModel) {
    case 'FLAT_RATE':
      return `${m(c.fixedFee)} por mês`;
    case 'ALLOWANCE_PLUS_OVERAGE':
      return `${m(c.fixedFee)}/mês com ${int.format(c.includedPagesMono ?? 0)} págs P&B + ${int.format(c.includedPagesColor ?? 0)} cor · excedente P&B ${r(c.overagePriceMono)} · cor ${r(c.overagePriceColor)}`;
    case 'PER_PAGE': {
      const base = `P&B ${r(c.pricePerPageMono)} · cor ${r(c.pricePerPageColor)} por página`;
      const minMono = c.minimumPagesMono ?? 0;
      const minColor = c.minimumPagesColor ?? 0;
      if (minMono === 0 && minColor === 0) return `${base} · sem mínimo`;
      return `${base} · mínimo ${int.format(minMono)} págs P&B + ${int.format(minColor)} cor`;
    }
    case 'PER_DEVICE_MINIMUM':
      return `P&B ${r(c.pricePerPageMono)} · cor ${r(c.pricePerPageColor)} por página · mínimo ${m(c.minimumChargePerDevice)} por impressora`;
  }
}
