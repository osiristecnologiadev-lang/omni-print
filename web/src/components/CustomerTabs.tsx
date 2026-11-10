import Link from 'next/link';

export type CustomerTab = 'resumo' | 'impressoras' | 'contrato' | 'faturas' | 'agentes' | 'config';

// One customer's areas as tabs (usability pass 2026-11-09): the customer
// page used to stack 11 unrelated sections. Resumo/Impressoras/Agentes/
// Configurações are views of /customers/[id] (?tab=); Contrato and Faturas
// are their own pages and show the same bar.
export function CustomerTabs({
  customerId,
  active,
  show,
}: {
  customerId: string;
  active: CustomerTab;
  show: { contract: boolean; invoices: boolean; agents: boolean };
}) {
  const base = `/customers/${customerId}`;
  const tabs: Array<{ key: CustomerTab; label: string; href: string; visible: boolean }> = [
    { key: 'resumo', label: 'Resumo', href: base, visible: true },
    { key: 'impressoras', label: 'Impressoras', href: `${base}?tab=impressoras`, visible: true },
    { key: 'contrato', label: 'Contrato', href: `${base}/contract`, visible: show.contract },
    { key: 'faturas', label: 'Faturas', href: `${base}/invoices`, visible: show.invoices },
    { key: 'agentes', label: 'Agentes e rede', href: `${base}?tab=agentes`, visible: show.agents },
    { key: 'config', label: 'Configurações', href: `${base}?tab=config`, visible: true },
  ];
  return (
    <nav aria-label="Áreas do cliente" className="-mt-4 mb-8 flex flex-wrap gap-x-1 border-b border-line">
      {tabs
        .filter((t) => t.visible)
        .map((t) => (
          <Link
            key={t.key}
            href={t.href}
            aria-current={t.key === active ? 'page' : undefined}
            className={`-mb-px shrink-0 border-b-2 px-3 py-2 text-sm transition-colors ${
              t.key === active ? 'border-accent font-medium text-ink' : 'border-transparent text-ink-muted hover:text-ink'
            }`}
          >
            {t.label}
          </Link>
        ))}
    </nav>
  );
}
