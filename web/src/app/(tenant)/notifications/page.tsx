import { forbidden } from 'next/navigation';
import { getSession, getNotifications, markAllNotificationsRead, type Notification } from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import { Panel } from '@/components/Panel';
import { Badge, type BadgeTone } from '@/components/Badge';
import { EmptyState } from '@/components/EmptyState';
import { syncNowAction, resolveNotificationAction } from './actions';
import { Button } from '@/components/Button';

function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso));
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

  const session = await getSession();
  if (session?.customerId) {
    forbidden();
  }

  const notifications = await getNotifications();

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

      {searchParams?.sync === 'changes' && (
        <p className="mb-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
          Notificações atualizadas.
        </p>
      )}
      {searchParams?.sync === 'nothing' && (
        <p className="mb-4 rounded-lg bg-surface-2 px-3 py-2 text-sm text-ink-muted">
          Nada mudou desde a última atualização.
        </p>
      )}

      <Panel className="mb-6">
        <p className="mb-3 text-xs text-ink-faint">
          Isso é verificado automaticamente todo dia. Use o botão abaixo para atualizar agora, sem esperar.
        </p>
        <form action={syncNowAction}>
          <Button type="submit" variant="secondary">
            Atualizar agora
          </Button>
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
                      <span className="shrink-0 text-xs text-ink-faint">{formatDateTime(n.updatedAt)}</span>
                    </div>
                    <p className="text-sm text-ink-muted">{n.body}</p>
                    <form action={boundResolve} className="mt-3">
                      <Button type="submit" variant="ghost" size="sm">
                        Resolver
                      </Button>
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
                        resolvida em {formatDateTime(n.resolvedAt as string)}
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
