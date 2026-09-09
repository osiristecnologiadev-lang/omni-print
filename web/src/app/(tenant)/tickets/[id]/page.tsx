import { notFound } from 'next/navigation';
import { getSession, getTicket, getAnyTicket, getUsers, getViewerTimeZone, type TicketStatus, type TicketPriority } from '@/lib/api';
import { isTicketSlaBreached } from '@/lib/sla';
import { PageHeader } from '@/components/PageHeader';
import { Panel } from '@/components/Panel';
import { Badge, type BadgeTone } from '@/components/Badge';
import { SubmitButton } from '@/components/SubmitButton';
import { Banner } from '@/components/Banner';
import { addTicketCommentAction, updateTicketAction } from '../actions';

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
const PRIORITY_LABEL: Record<TicketPriority, string> = { LOW: 'Baixa', MEDIUM: 'Média', HIGH: 'Alta', URGENT: 'Urgente' };
const PRIORITY_TONE: Record<TicketPriority, BadgeTone> = { LOW: 'neutral', MEDIUM: 'info', HIGH: 'warning', URGENT: 'critical' };

// Server Components render on Railway (UTC) - see getViewerTimeZone.
function formatDateTime(iso: string, timeZone?: string): string {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone }).format(new Date(iso));
}

const inputClass =
  'mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none transition-colors focus:border-accent';
const selectClass = inputClass;

export default async function TicketDetailPage(props: PageProps<'/tickets/[id]'>) {
  const { id } = await props.params;
  const searchParams = await props.searchParams;
  const session = await getSession();
  if (!session) return null;

  const isTenantWide = !session.customerId;
  const ticket = isTenantWide ? await getAnyTicket(id) : await getTicket(session.customerId as string, id);
  if (!ticket) {
    notFound();
  }

  const staff = isTenantWide ? (await getUsers()).filter((u) => !u.customerId && !u.revokedAt) : [];
  const tz = await getViewerTimeZone();
  const breached = ticket.status !== 'RESOLVED' && ticket.status !== 'CLOSED' && isTicketSlaBreached(ticket);

  const boundComment = addTicketCommentAction.bind(null, ticket.customerId, ticket.id);
  const boundUpdate = updateTicketAction.bind(null, ticket.id);

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <PageHeader title={ticket.subject} subtitle={isTenantWide ? ticket.customer.name : undefined} />

      {searchParams?.updated === '1' && <Banner tone="success">Chamado atualizado.</Banner>}
      {searchParams?.updateError === '1' && <Banner tone="error">Não foi possível atualizar o chamado. Tente novamente.</Banner>}
      {searchParams?.commentAdded === '1' && <Banner tone="success">Comentário adicionado.</Banner>}
      {searchParams?.commentError === '1' && <Banner tone="error">Não foi possível adicionar o comentário. Tente novamente.</Banner>}

      <div className="mb-6 flex flex-wrap items-center gap-2">
        <Badge tone={STATUS_TONE[ticket.status]}>{STATUS_LABEL[ticket.status]}</Badge>
        <Badge tone={PRIORITY_TONE[ticket.priority]}>{PRIORITY_LABEL[ticket.priority]}</Badge>
        {breached && <Badge tone="critical">SLA estourado</Badge>}
        <span className="text-xs text-ink-faint">Prazo: {formatDateTime(ticket.slaDueAt, tz)}</span>
      </div>

      <Panel className="mb-6">
        <p className="mb-3 whitespace-pre-line text-sm text-ink">{ticket.description}</p>
        <p className="text-xs text-ink-faint">
          Aberto por {ticket.createdByUser.name ?? ticket.createdByUser.email} em {formatDateTime(ticket.createdAt, tz)}
          {ticket.device &&
            ` · Impressora: ${ticket.device.customLabel ? `${ticket.device.customLabel} — ` : ''}${
              ticket.device.printerName ?? ticket.device.name ?? 'Sem nome capturado'
            } — ${ticket.device.host}`}
        </p>
        {ticket.assignedToUser && (
          <p className="mt-1 text-xs text-ink-faint">Responsável: {ticket.assignedToUser.name ?? ticket.assignedToUser.email}</p>
        )}
      </Panel>

      {isTenantWide && (
        <Panel className="mb-6">
          <h2 className="mb-3 text-sm font-medium text-ink">Gerenciar chamado</h2>
          <form action={boundUpdate} className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <label className="block text-xs text-ink-muted">
              Status
              <select name="status" defaultValue={ticket.status} className={`mt-1 ${selectClass}`}>
                {Object.entries(STATUS_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs text-ink-muted">
              Prioridade
              <select name="priority" defaultValue={ticket.priority} className={`mt-1 ${selectClass}`}>
                {Object.entries(PRIORITY_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs text-ink-muted">
              Responsável
              <select name="assignedToUserId" defaultValue={ticket.assignedToUser?.id ?? ''} className={`mt-1 ${selectClass}`}>
                <option value="">Ninguém</option>
                {staff.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name ?? u.email}
                  </option>
                ))}
              </select>
            </label>
            <div className="sm:col-span-3">
              <SubmitButton variant="secondary" pendingLabel="Salvando...">
                Salvar
              </SubmitButton>
            </div>
          </form>
        </Panel>
      )}

      <Panel>
        <h2 className="mb-4 text-sm font-medium text-ink">Comentários</h2>
        {(ticket.comments?.length ?? 0) === 0 ? (
          <p className="text-sm text-ink-faint">Nenhum comentário ainda.</p>
        ) : (
          <div className="mb-4 space-y-3">
            {ticket.comments!.map((c) => (
              <div key={c.id} className="rounded-lg bg-surface-2 p-3">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-ink">{c.authorUser.name ?? c.authorUser.email}</span>
                  <span className="text-xs text-ink-faint">{formatDateTime(c.createdAt, tz)}</span>
                </div>
                <p className="whitespace-pre-line text-sm text-ink-muted">{c.body}</p>
              </div>
            ))}
          </div>
        )}
        <form action={boundComment}>
          <textarea name="body" required minLength={1} rows={3} className={inputClass} placeholder="Escreva um comentário..." />
          <SubmitButton variant="secondary" className="mt-2" pendingLabel="Enviando...">
            Comentar
          </SubmitButton>
        </form>
      </Panel>
    </main>
  );
}
