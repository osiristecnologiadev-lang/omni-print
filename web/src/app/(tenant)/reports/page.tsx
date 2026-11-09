import Link from 'next/link';
import { forbidden } from 'next/navigation';
import { getViewerAccess } from '@/lib/api';
import { hasPermission } from '@/lib/permissions';
import { PageHeader } from '@/components/PageHeader';

// One place for every report - each card says what it answers, so nobody
// has to open a report to find out whether it's the one they need.
type Card = { href: string; title: string; answers: string; detail: string; csv?: boolean; show: boolean };

export default async function ReportsHubPage() {
  const access = await getViewerAccess();
  const canReports = hasPermission(access, 'reports');
  const canInvoices = hasPermission(access, 'invoices');
  const canContracts = hasPermission(access, 'contracts');
  if (!canReports && !canInvoices && !canContracts) {
    forbidden();
  }

  const groups: Array<{ title: string; cards: Card[] }> = [
    {
      title: 'Impressão',
      cards: [
        {
          href: '/reports/pages',
          title: 'Páginas por impressora',
          answers: 'Quantas páginas cada impressora imprimiu no mês?',
          detail: 'Leitura inicial, leitura final e quantidade de cada impressora, por cliente. É a base para conferir a cobrança.',
          csv: true,
          show: canReports,
        },
      ],
    },
    {
      title: 'Financeiro',
      cards: [
        {
          href: '/reports/revenue',
          title: 'Uso e receita',
          answers: 'Quanto faturei, recebi e quanto está em aberto?',
          detail: 'Faturamento e páginas mês a mês e o comparativo por cliente. Conta só faturas já geradas.',
          csv: true,
          show: canReports,
        },
        {
          href: '/contracts',
          title: 'Contratos e mês em andamento',
          answers: 'Quanto o mês atual já soma em cada cliente?',
          detail: 'Todos os contratos lado a lado, com o valor previsto do período que ainda não fechou.',
          show: canContracts,
        },
        {
          href: '/invoices?status=PENDING',
          title: 'Faturas em aberto',
          answers: 'Quem ainda não pagou?',
          detail: 'Faturas pendentes de todos os clientes, com as atrasadas destacadas.',
          show: canInvoices,
        },
      ],
    },
  ];

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <PageHeader title="Relatórios" subtitle="Todos os relatórios num lugar só. Escolha pela pergunta que você quer responder." />

      {groups.map((g) => {
        const cards = g.cards.filter((c) => c.show);
        if (cards.length === 0) return null;
        return (
          <section key={g.title} className="mb-8">
            <h2 className="mb-3 text-xs font-medium tracking-wide text-ink-faint uppercase">{g.title}</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {cards.map((c) => (
                <Link
                  key={c.href}
                  href={c.href}
                  className="group rounded-xl border border-line bg-surface p-5 transition-colors hover:border-accent"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <h3 className="font-medium text-ink group-hover:text-accent">{c.title}</h3>
                    {c.csv && <span className="text-[11px] text-ink-faint">exporta CSV</span>}
                  </div>
                  <p className="mt-1 text-sm text-ink">{c.answers}</p>
                  <p className="mt-2 text-xs text-ink-muted">{c.detail}</p>
                </Link>
              ))}
            </div>
          </section>
        );
      })}
    </main>
  );
}
