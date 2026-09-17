import { forbidden } from 'next/navigation';
import { getAgentTokenLog, getCustomer, getViewerAccess, getViewerTimeZone } from '@/lib/api';
import { hasPermission } from '@/lib/permissions';
import { PageHeader } from '@/components/PageHeader';
import { Panel } from '@/components/Panel';
import { EmptyState } from '@/components/EmptyState';

function formatDateTime(iso: string, timeZone?: string): string {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone }).format(new Date(iso));
}

export default async function AgentTokenLogPage(props: PageProps<'/customers/[id]/agent-tokens/[tokenId]/log'>) {
  const { id, tokenId } = await props.params;

  const access = await getViewerAccess();
  if (!hasPermission(access, 'agent')) {
    forbidden();
  }

  const [customer, log, tz] = await Promise.all([getCustomer(id), getAgentTokenLog(id, tokenId), getViewerTimeZone()]);

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <PageHeader
        title="Log do agente"
        subtitle={customer.name}
        back={{ href: `/customers/${id}`, label: 'Voltar para o cliente' }}
      />

      {!log.logContent || !log.logUploadedAt ? (
        <EmptyState
          title="Nenhum log recebido ainda"
          hint='Use o botão "Buscar log agora" na página do cliente - o agente envia assim que perceber o pedido (até 2 minutos, se estiver online).'
        />
      ) : (
        <Panel>
          <p className="mb-3 text-xs text-ink-faint">Enviado em {formatDateTime(log.logUploadedAt, tz)}.</p>
          <pre className="max-h-[70vh] overflow-auto rounded-lg bg-surface-2 p-4 font-mono text-xs whitespace-pre-wrap text-ink">
            {log.logContent}
          </pre>
        </Panel>
      )}
    </main>
  );
}
