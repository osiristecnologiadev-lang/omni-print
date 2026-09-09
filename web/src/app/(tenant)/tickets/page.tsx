import Link from 'next/link';
import { getSession, getAllTickets, getCustomerTickets, getViewerTimeZone, type Ticket, type TicketStatus } from '@/lib/api';
import { isTicketSlaBreached } from '@/lib/sla';
import { PageHeader } from '@/components/PageHeader';
import { Panel } from '@/components/Panel';
import { Badge, type BadgeTone } from '@/components/Badge';
import { EmptyState } from '@/components/EmptyState';
import { Button } from '@/components/Button';

const STATUS_LABEL: Record<TicketStatus, string> = {
  OPEN: 'Aberto',
  IN_PROGRESS: 'Em andamento',
  RESOLVED: 'Resolvido',
  CLOSED: 'Fechado',
};
const STATUS_TONE: Record<TicketStatus, BadgeTone> = {
  OPEN: 'warning',
  IN_PROGRESS: 'info',
  RESOLVED: 'ok',
  CLOSED: 'neutral',
};
const PRIORITY_LABEL: Record<string, string> = { LOW: 'Baixa', MEDIUM: 'Média', HIGH: 'Alta', URGENT: 'Urgente' };
const PRIORITY_TONE: Record<string, BadgeTone> = { LOW: 'neutral', MEDIUM: 'info', HIGH: 'warning', URGENT: 'critical' };

const STATUS_OPTIONS: TicketStatus[] = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'];

// Server Components render on Railway (UTC) - see getViewerTimeZone.
function formatDateTime(iso: string, timeZone?: string): string {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone }).format(new Date(iso));
}

const selectClass = 'rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent';

export default async function TicketsPage(props: PageProps<'/tickets'>) {
  const searchParams = await props.searchParams;
  const session = await getSession();
  if (!session) return null;

  const isTenantWide = !session.customerId;
  const statusFilter = STATUS_OPTIONS.includes(searchParams?.status as TicketStatus)
    ? (searchParams?.status as TicketStatus)
    : undefined;

  const [tickets, tz]: [Ticket[], string | undefined] = await Promise.all([
    isTenantWide ? getAllTickets(statusFilter) : getCustomerTickets(session.customerId as string, statusFilter),
    getViewerTimeZone(),
  ]);

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <PageHeader title="Chamados" subtitle="Suporte técnico e solicitações relacionadas às impressoras." />

      <div className="mb-6 flex items-center justify-between gap-3">
        <form method="get" className="flex items-center gap-2">
          <select name="status" defaultValue={statusFilter ?? ''} className={selectClass}>
            <option value="">Todos os status</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
          <Button type="submit" variant="secondary">
            Filtrar
          </Button>
        </form>
        <Link href="/tickets/new">
          <Button type="button" variant="primary">
            Abrir chamado
          </Button>
        </Link>
      </div>

      {tickets.length === 0 ? (
        <EmptyState title="Nenhum chamado ainda" hint="Abra um chamado quando precisar de suporte técnico." />
      ) : (
        <div className="space-y-2">
          {tickets.map((t) => {
            const breached = t.status !== 'RESOLVED' && t.status !== 'CLOSED' && isTicketSlaBreached(t);
            return (
              <Link key={t.id} href={`/tickets/${t.id}`}>
                <Panel className="transition-colors hover:border-accent">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-ink">{t.subject}</p>
                      <p className="mt-0.5 text-xs text-ink-faint">
                        {isTenantWide && `${t.customer.name} · `}
                        Aberto por {t.createdByUser.name ?? t.createdByUser.email} em {formatDateTime(t.createdAt, tz)}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {breached && <Badge tone="critical">SLA estourado</Badge>}
                      <Badge tone={PRIORITY_TONE[t.priority]}>{PRIORITY_LABEL[t.priority]}</Badge>
                      <Badge tone={STATUS_TONE[t.status]}>{STATUS_LABEL[t.status]}</Badge>
                    </div>
                  </div>
                </Panel>
              </Link>
            );
          })}
        </div>
      )}
    </main>
  );
}
