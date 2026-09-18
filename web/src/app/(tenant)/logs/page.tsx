import Link from 'next/link';
import { forbidden } from 'next/navigation';
import { getAgentLogs, getCustomers, getViewerAccess, getViewerTimeZone } from '@/lib/api';
import { hasPermission } from '@/lib/permissions';
import { PageHeader } from '@/components/PageHeader';
import { Panel } from '@/components/Panel';
import { EmptyState } from '@/components/EmptyState';
import { Button } from '@/components/Button';

function formatDateTime(iso: string, timeZone?: string): string {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone }).format(new Date(iso));
}

function formatDay(day: string): string {
  // day is a plain "YYYY-MM-DD" agent-local calendar day, not an instant -
  // parsing it as UTC midnight and formatting in UTC keeps it from shifting
  // to the previous day for a viewer west of UTC.
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(`${day}T00:00:00Z`));
}

const selectClass = 'rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent';

export default async function LogsPage(props: PageProps<'/logs'>) {
  const searchParams = await props.searchParams;
  const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
  const customerId = str(searchParams?.customerId);
  const date = str(searchParams?.date);

  const access = await getViewerAccess();
  if (!hasPermission(access, 'agent_logs')) {
    forbidden();
  }

  const [entries, customers, tz] = await Promise.all([
    getAgentLogs({ customerId, date }),
    getCustomers(),
    getViewerTimeZone(),
  ]);

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <PageHeader
        title="Logs do Agent"
        subtitle="Histórico dos logs enviados pelos agentes instalados - um snapshot por dia, automático ou via 'Buscar log agora' na página do cliente."
      />

      <form method="get" className="mb-6 flex flex-wrap items-end gap-2">
        <select name="customerId" defaultValue={customerId ?? ''} className={selectClass}>
          <option value="">Todos os clientes</option>
          {customers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 text-sm text-ink-muted">
          Data
          <input type="date" name="date" defaultValue={date ?? ''} className={selectClass} />
        </label>
        <Button type="submit" variant="secondary">
          Filtrar
        </Button>
        {(customerId || date) && (
          <Link href="/logs" className="text-sm text-accent hover:underline">
            Limpar filtros
          </Link>
        )}
      </form>

      {entries.length === 0 ? (
        <EmptyState
          title={customerId || date ? 'Nenhum log encontrado com esses filtros' : 'Nenhum log recebido ainda'}
          hint={
            customerId || date
              ? 'Tente ampliar o período ou remover algum filtro.'
              : 'Aparece aqui automaticamente uma vez por dia para cada agente instalado, ou na hora ao clicar em "Buscar log agora" na página do cliente.'
          }
        />
      ) : (
        <div className="space-y-3">
          {entries.map((e) => (
            <Link key={e.id} href={`/logs/${e.id}`}>
              <Panel className="transition-colors hover:bg-surface-2">
                <div className="mb-1 flex items-center justify-between gap-3">
                  <span className="font-medium text-ink">{e.agentToken.customer?.name ?? 'Cliente removido'}</span>
                  <span className="shrink-0 text-xs text-ink-faint">{formatDay(e.date)}</span>
                </div>
                <p className="text-sm text-ink-muted">
                  {e.agentToken.label ?? 'Token sem nome'} · enviado em {formatDateTime(e.uploadedAt, tz)}
                </p>
              </Panel>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
