import Link from 'next/link';
import { forbidden } from 'next/navigation';
import { getViewerAccess, getAuditLog, getViewerTimeZone } from '@/lib/api';
import { hasPermission } from '@/lib/permissions';
import { PageHeader } from '@/components/PageHeader';
import { Panel } from '@/components/Panel';
import { EmptyState } from '@/components/EmptyState';
import { Button } from '@/components/Button';

// Server Components render on Railway (UTC) - see getViewerTimeZone.
function formatDateTime(iso: string, timeZone?: string): string {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'medium', timeZone }).format(new Date(iso));
}

// Translated to Portuguese only here at display time - the API stores the
// action as a plain dotted verb (see AuditLogService's own comment).
// Anything not in this map falls back to the raw action string, so a
// forgotten translation never hides an entry.
const ACTION_LABEL: Record<string, string> = {
  'customer.create': 'Cliente criado',
  'customer.update': 'Dados do cliente editados',
  'agent_token.create': 'Token de agente gerado',
  'agent_token.revoke': 'Token de agente revogado',
  'enrollment_code.create': 'Código de instalação gerado',
  'enrollment_code.revoke': 'Código de instalação revogado',
  'user.create': 'Usuário criado',
  'user.revoke': 'Usuário revogado',
  'user.update_permissions': 'Permissões do usuário alteradas',
  'device.reassign_customer': 'Dispositivo reatribuído a outro cliente',
  'device.set_label': 'Apelido do dispositivo alterado',
  'device.set_manual_baseline': 'Leitura inicial manual definida',
  'contract.create': 'Contrato criado ou renegociado',
  'contract.update': 'Contrato editado',
  'contract.cancel': 'Contrato cancelado',
  'invoice.generate': 'Fatura gerada',
  'invoice.mark_paid': 'Fatura marcada como paga',
  'invoice.cancel': 'Fatura cancelada',
  'ticket.update': 'Chamado atualizado',
  'notification.resolve': 'Notificação resolvida',
  'tenant.update': 'Dados da empresa editados',
  'platform.create_tenant_user': 'Usuário criado pela equipe OmniPrint',
};

function actionLabel(action: string): string {
  return ACTION_LABEL[action] ?? action;
}

const TARGET_TYPE_LABEL: Record<string, string> = {
  Device: 'Dispositivo',
  Customer: 'Cliente',
  AgentToken: 'Token de agente',
  AgentEnrollmentCode: 'Código de instalação',
  Contract: 'Contrato',
  Invoice: 'Fatura',
  User: 'Usuário',
  Tenant: 'Empresa',
  Notification: 'Notificação',
  Ticket: 'Chamado',
};

const selectClass = 'rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent';

export default async function AuditLogPage(props: PageProps<'/audit-log'>) {
  const searchParams = await props.searchParams;
  const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
  const cursor = str(searchParams?.cursor);
  const action = str(searchParams?.action);
  const targetType = str(searchParams?.targetType);
  const from = str(searchParams?.from);
  const to = str(searchParams?.to);

  const access = await getViewerAccess();
  if (!hasPermission(access, 'audit_log')) {
    forbidden();
  }

  const [page, tz] = await Promise.all([
    getAuditLog({ cursor, action, targetType, from, to }),
    getViewerTimeZone(),
  ]);

  // Carried into the "load more" link so paging forward doesn't drop the
  // active filters back to "show everything".
  const filterParams = new URLSearchParams();
  if (action) filterParams.set('action', action);
  if (targetType) filterParams.set('targetType', targetType);
  if (from) filterParams.set('from', from);
  if (to) filterParams.set('to', to);

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <PageHeader
        title="Log de auditoria"
        subtitle="Quem fez o quê, e quando - revogar um token, reatribuir um dispositivo, cancelar um contrato, e outras ações administrativas."
      />

      <form method="get" className="mb-6 flex flex-wrap items-end gap-2">
        <select name="action" defaultValue={action ?? ''} className={selectClass}>
          <option value="">Todas as ações</option>
          {Object.entries(ACTION_LABEL).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <select name="targetType" defaultValue={targetType ?? ''} className={selectClass}>
          <option value="">Qualquer tipo de item</option>
          {Object.entries(TARGET_TYPE_LABEL).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 text-sm text-ink-muted">
          De
          <input type="date" name="from" defaultValue={from ?? ''} className={selectClass} />
        </label>
        <label className="flex items-center gap-1.5 text-sm text-ink-muted">
          Até
          <input type="date" name="to" defaultValue={to ?? ''} className={selectClass} />
        </label>
        <Button type="submit" variant="secondary">
          Filtrar
        </Button>
        {(action || targetType || from || to) && (
          <Link href="/audit-log" className="text-sm text-accent hover:underline">
            Limpar filtros
          </Link>
        )}
      </form>

      {page.entries.length === 0 ? (
        <EmptyState
          title={action || targetType || from || to ? 'Nenhuma ação encontrada com esses filtros' : 'Nenhuma ação registrada ainda'}
          hint={
            action || targetType || from || to
              ? 'Tente ampliar o período ou remover algum filtro.'
              : 'Aparece aqui assim que alguma ação administrativa acontecer no painel.'
          }
        />
      ) : (
        <div className="space-y-3">
          {page.entries.map((e) => (
            <Panel key={e.id}>
              <div className="mb-1 flex items-center justify-between gap-3">
                <span className="font-medium text-ink">{actionLabel(e.action)}</span>
                <span className="shrink-0 text-xs text-ink-faint">{formatDateTime(e.createdAt, tz)}</span>
              </div>
              <p className="text-sm text-ink-muted">
                {e.actorLabel ?? 'ator desconhecido'}
                {e.targetLabel && <> · {e.targetLabel}</>}
              </p>
            </Panel>
          ))}
        </div>
      )}

      {page.nextCursor && (
        <div className="mt-4 text-center">
          <Link
            href={`/audit-log?${new URLSearchParams({ ...Object.fromEntries(filterParams), cursor: page.nextCursor }).toString()}`}
            className="text-sm text-accent hover:underline"
          >
            Carregar mais
          </Link>
        </div>
      )}
    </main>
  );
}
