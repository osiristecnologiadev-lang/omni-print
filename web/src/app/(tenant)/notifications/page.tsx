import { forbidden } from 'next/navigation';
import { getViewerAccess, getNotifications, markAllNotificationsRead, getViewerTimeZone, type Notification } from '@/lib/api';
import { hasPermission } from '@/lib/permissions';
import { PageHeader } from '@/components/PageHeader';
import { Panel } from '@/components/Panel';
import { Badge, type BadgeTone } from '@/components/Badge';
import { EmptyState } from '@/components/EmptyState';
import { syncNowAction, resolveNotificationAction } from './actions';
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
};

const TYPE_TONE: Record<Notification['type'], BadgeTone> = {
  OVERDUE_INVOICE: 'critical',
  EXPIRING_CONTRACT: 'warning',
  CRITICAL_DEVICE_ALERT: 'critical',
  LOW_SUPPLY: 'warning',
  UNASSIGNED_DEVICE: 'warning',
};

export default async function NotificationsPage(props: PageProps<'/notifications'>) {
  const searchParams = await props.searchParams;

  const access = await getViewerAccess();
  if (!hasPermission(access, 'notifications')) {
    forbidden();
  }

  const [notifications, tz] = await Promise.all([getNotifications(), getViewerTimeZone()]);

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
                        <span className="font-medium text-ink">{n.title}</span>
                      </div>
                      <span className="shrink-0 text-xs text-ink-faint">{formatDateTime(n.updatedAt, tz)}</span>
                    </div>
                    <p className="text-sm text-ink-muted">{n.body}</p>
                    <form action={boundResolve} className="mt-3">
                      <SubmitButton variant="ghost" size="sm" pendingLabel="Resolvendo...">
                        Resolver
                      </SubmitButton>
                    </form>
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
                        <span className="font-medium text-ink">{n.title}</span>
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
