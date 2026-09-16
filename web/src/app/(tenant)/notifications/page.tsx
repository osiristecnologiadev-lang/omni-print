import Link from 'next/link';
import { forbidden } from 'next/navigation';
import {
  getViewerAccess,
  getNotifications,
  markAllNotificationsRead,
  getNotificationEmailPreferences,
  getTicketAutomationPreferences,
  getViewerTimeZone,
  type Notification,
  type NotificationType,
} from '@/lib/api';
import { hasPermission } from '@/lib/permissions';
import { PageHeader } from '@/components/PageHeader';
import { Panel } from '@/components/Panel';
import { Badge, type BadgeTone } from '@/components/Badge';
import { EmptyState } from '@/components/EmptyState';
import {
  syncNowAction,
  resolveNotificationAction,
  updateEmailPreferencesAction,
  updateTicketAutomationPreferencesAction,
} from './actions';
import { SubmitButton } from '@/components/SubmitButton';
import { Banner } from '@/components/Banner';

// Server Components render on Railway (UTC) - see getViewerTimeZone.
function formatDateTime(iso: string, timeZone?: string): string {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone }).format(new Date(iso));
}

const TYPE_LABEL: Record<Notification['type'], string> = {
  OVERDUE_INVOICE: 'Fatura vencida',
  EXPIRING_CONTRACT: 'Contrato',
  CRITICAL_DEVICE_ALERT: 'Dispositivo',
  LOW_SUPPLY: 'Suprimento',
  UNASSIGNED_DEVICE: 'Sem cliente',
  TICKET_SLA_BREACH: 'Chamado',
};

const TYPE_TONE: Record<Notification['type'], BadgeTone> = {
  OVERDUE_INVOICE: 'critical',
  EXPIRING_CONTRACT: 'warning',
  CRITICAL_DEVICE_ALERT: 'critical',
  LOW_SUPPLY: 'warning',
  UNASSIGNED_DEVICE: 'warning',
  TICKET_SLA_BREACH: 'critical',
};

const ALL_TYPES: NotificationType[] = [
  'OVERDUE_INVOICE',
  'EXPIRING_CONTRACT',
  'CRITICAL_DEVICE_ALERT',
  'LOW_SUPPLY',
  'UNASSIGNED_DEVICE',
  'TICKET_SLA_BREACH',
];

// Mirrors api's AUTO_TICKETABLE_TYPES (notifications.service.ts) exactly -
// a subset of ALL_TYPES: UNASSIGNED_DEVICE never has a customerId (a
// ticket requires one) and TICKET_SLA_BREACH opening a ticket about a
// ticket being late would be circular, so neither is offered here even
// though both appear in the email-preferences list above.
const AUTO_TICKETABLE_TYPES: NotificationType[] = ['OVERDUE_INVOICE', 'EXPIRING_CONTRACT', 'CRITICAL_DEVICE_ALERT', 'LOW_SUPPLY'];

export default async function NotificationsPage(props: PageProps<'/notifications'>) {
  const searchParams = await props.searchParams;

  const access = await getViewerAccess();
  if (!hasPermission(access, 'notifications')) {
    forbidden();
  }

  const [notifications, emailPrefs, ticketAutomationPrefs, tz] = await Promise.all([
    getNotifications(),
    getNotificationEmailPreferences(),
    getTicketAutomationPreferences(),
    getViewerTimeZone(),
  ]);

  // Opening this screen is what clears the bell's badge - a deliberate side
  // effect of a page visit (same pattern as most notification centers), not
  // something that needs its own button.
  if (notifications.some((n) => !n.readAt)) {
    await markAllNotificationsRead();
  }

  const unresolved = notifications.filter((n) => !n.resolvedAt);
  const resolved = notifications.filter((n) => n.resolvedAt);

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <PageHeader
        title="Notificações"
        subtitle="Faturas vencidas, contratos perto do fim, alertas críticos e suprimentos acabando. Resolva um item para parar de ser lembrado dele."
      />

      {searchParams?.sync === 'changes' && <Banner tone="success">Notificações atualizadas.</Banner>}
      {searchParams?.sync === 'nothing' && (
        <p className="mb-4 rounded-lg bg-surface-2 px-3 py-2 text-sm text-ink-muted">
          Nada mudou desde a última atualização.
        </p>
      )}
      {searchParams?.sync === 'error' && <Banner tone="error">Não foi possível atualizar as notificações. Tente novamente.</Banner>}
      {searchParams?.resolved === '1' && <Banner tone="success">Notificação resolvida.</Banner>}
      {searchParams?.resolveError === '1' && <Banner tone="error">Não foi possível resolver a notificação. Tente novamente.</Banner>}
      {searchParams?.prefsSaved === '1' && <Banner tone="success">Preferências de e-mail salvas.</Banner>}
      {searchParams?.prefsError === '1' && <Banner tone="error">Não foi possível salvar as preferências. Tente novamente.</Banner>}
      {searchParams?.ticketPrefsSaved === '1' && <Banner tone="success">Preferências de chamado automático salvas.</Banner>}
      {searchParams?.ticketPrefsError === '1' && (
        <Banner tone="error">Não foi possível salvar as preferências. Tente novamente.</Banner>
      )}

      <Panel className="mb-6">
        <p className="mb-3 text-xs text-ink-faint">
          Isso é verificado automaticamente todo dia. Use o botão abaixo para atualizar agora, sem esperar.
        </p>
        <form action={syncNowAction}>
          <SubmitButton variant="secondary" pendingLabel="Atualizando...">
            Atualizar agora
          </SubmitButton>
        </form>
      </Panel>

      <Panel className="mb-6">
        <h2 className="mb-1 text-sm font-medium text-ink">Notificações por e-mail</h2>
        <p className="mb-4 text-xs text-ink-faint">
          Vem desativado por padrão. Quando ativo, manda no máximo um e-mail por dia (na verificação automática de
          madrugada - clicar em &quot;Atualizar agora&quot; nunca dispara e-mail), só com o que for realmente novo, e só
          das categorias marcadas abaixo.
        </p>
        <form action={updateEmailPreferencesAction} className="space-y-3">
          <label className="flex items-center gap-2 text-sm font-medium text-ink">
            <input type="checkbox" name="emailEnabled" defaultChecked={emailPrefs.emailEnabled} />
            Ativar notificações por e-mail
          </label>
          <div className="flex flex-wrap gap-x-5 gap-y-2 border-t border-line pt-3">
            {ALL_TYPES.map((t) => (
              <label key={t} className="flex items-center gap-2 text-sm text-ink-muted">
                <input type="checkbox" name="emailTypes" value={t} defaultChecked={emailPrefs.emailTypes.includes(t)} />
                {TYPE_LABEL[t]}
              </label>
            ))}
          </div>
          <SubmitButton variant="secondary" pendingLabel="Salvando...">
            Salvar preferências
          </SubmitButton>
        </form>
      </Panel>

      <Panel className="mb-6">
        <h2 className="mb-1 text-sm font-medium text-ink">Abrir chamado automaticamente</h2>
        <p className="mb-4 text-xs text-ink-faint">
          Vem desativado por padrão. Quando ativo, um alerta novo das categorias marcadas abaixo abre um chamado
          sozinho (visível em Chamados como aberto pelo sistema), sem esperar a verificação de madrugada - funciona
          também ao clicar em &quot;Atualizar agora&quot;.
        </p>
        <form action={updateTicketAutomationPreferencesAction} className="space-y-3">
          <label className="flex items-center gap-2 text-sm font-medium text-ink">
            <input type="checkbox" name="autoTicketEnabled" defaultChecked={ticketAutomationPrefs.autoTicketEnabled} />
            Ativar abertura automática de chamados
          </label>
          <div className="flex flex-wrap gap-x-5 gap-y-2 border-t border-line pt-3">
            {AUTO_TICKETABLE_TYPES.map((t) => (
              <label key={t} className="flex items-center gap-2 text-sm text-ink-muted">
                <input
                  type="checkbox"
                  name="autoTicketTypes"
                  value={t}
                  defaultChecked={ticketAutomationPrefs.autoTicketTypes.includes(t)}
                />
                {TYPE_LABEL[t]}
              </label>
            ))}
          </div>
          <SubmitButton variant="secondary" pendingLabel="Salvando...">
            Salvar preferências
          </SubmitButton>
        </form>
      </Panel>

      {notifications.length === 0 ? (
        <EmptyState title="Nenhuma notificação ainda" hint="Aparecem aqui assim que houver algo que precise da sua atenção." />
      ) : (
        <div className="space-y-6">
          {unresolved.length > 0 && (
            <div className="space-y-3">
              {unresolved.map((n) => {
                const boundResolve = resolveNotificationAction.bind(null, n.id);
                return (
                  <Panel key={n.id}>
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <Badge tone={TYPE_TONE[n.type]}>{TYPE_LABEL[n.type]}</Badge>
                        {n.linkHref ? (
                          <Link href={n.linkHref} className="font-medium text-ink transition-colors hover:text-accent hover:underline">
                            {n.title}
                          </Link>
                        ) : (
                          <span className="font-medium text-ink">{n.title}</span>
                        )}
                      </div>
                      <span className="shrink-0 text-xs text-ink-faint">{formatDateTime(n.updatedAt, tz)}</span>
                    </div>
                    <p className="text-sm text-ink-muted">{n.body}</p>
                    <div className="mt-3 flex items-center gap-4">
                      <form action={boundResolve}>
                        <SubmitButton variant="ghost" size="sm" pendingLabel="Resolvendo...">
                          Resolver
                        </SubmitButton>
                      </form>
                      {n.linkHref && (
                        <Link href={n.linkHref} className="text-xs font-medium text-ink-muted transition-colors hover:text-accent">
                          Ver detalhes →
                        </Link>
                      )}
                    </div>
                  </Panel>
                );
              })}
            </div>
          )}

          {resolved.length > 0 && (
            <div>
              <h2 className="mb-3 text-xs font-medium tracking-wide text-ink-faint uppercase">Resolvidas</h2>
              <div className="space-y-3">
                {resolved.map((n) => (
                  <Panel key={n.id} className="opacity-60">
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <Badge tone="neutral">{TYPE_LABEL[n.type]}</Badge>
                        {n.linkHref ? (
                          <Link href={n.linkHref} className="font-medium text-ink transition-colors hover:text-accent hover:underline">
                            {n.title}
                          </Link>
                        ) : (
                          <span className="font-medium text-ink">{n.title}</span>
                        )}
                      </div>
                      <span className="shrink-0 text-xs text-ink-faint">
                        resolvida em {formatDateTime(n.resolvedAt as string, tz)}
                      </span>
                    </div>
                    <p className="text-sm text-ink-muted">{n.body}</p>
                  </Panel>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </main>
  );
}
