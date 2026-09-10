import Link from 'next/link';
import { forbidden } from 'next/navigation';
import { getSession, getAuditLog, getViewerTimeZone } from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import { Panel } from '@/components/Panel';
import { EmptyState } from '@/components/EmptyState';

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

export default async function AuditLogPage(props: PageProps<'/audit-log'>) {
  const searchParams = await props.searchParams;
  const cursor = typeof searchParams?.cursor === 'string' ? searchParams.cursor : undefined;

  const session = await getSession();
  if (session?.customerId) {
    forbidden();
  }

  const [page, tz] = await Promise.all([getAuditLog(cursor), getViewerTimeZone()]);

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <PageHeader
        title="Log de auditoria"
        subtitle="Quem fez o quê, e quando - revogar um token, reatribuir um dispositivo, cancelar um contrato, e outras ações administrativas."
      />

      {page.entries.length === 0 ? (
        <EmptyState
          title="Nenhuma ação registrada ainda"
          hint="Aparece aqui assim que alguma ação administrativa acontecer no painel."
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
            href={`/audit-log?cursor=${encodeURIComponent(page.nextCursor)}`}
            className="text-sm text-accent hover:underline"
          >
            Carregar mais
          </Link>
        </div>
      )}
    </main>
  );
}
