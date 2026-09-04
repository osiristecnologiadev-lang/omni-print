import Link from 'next/link';
import { forbidden } from 'next/navigation';
import { getSession, getAgentLatestRelease } from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import { Panel } from '@/components/Panel';
import { EmptyState } from '@/components/EmptyState';
import { Button } from '@/components/Button';

function formatBytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${(bytes / 1024).toFixed(0)} KB`;
}

// Tenant-wide only - setting up a new agent install is administrative, same
// access rule as customer/contract management (see AgentDownloadController's
// assertTenantWide on the API side).
export default async function AgentDownloadPage() {
  const session = await getSession();
  if (session?.customerId) {
    forbidden();
  }

  const windows = await getAgentLatestRelease('WINDOWS');

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <PageHeader
        title="Baixar o agente"
        subtitle="Instale o agente OmniPrint na rede do seu cliente para começar a monitorar as impressoras dele."
      />

      {!windows || !windows.hasInstaller ? (
        <EmptyState
          title="Nenhum instalador disponível ainda"
          hint="A OmniPrint ainda não publicou uma versão do instalador para Windows."
        />
      ) : (
        <Panel className="mb-6">
          <div className="mb-1 flex items-center justify-between gap-3">
            <h2 className="text-sm font-medium text-ink">Windows — v{windows.version}</h2>
            {windows.installerSizeBytes != null && (
              <span className="text-xs text-ink-faint">{formatBytes(windows.installerSizeBytes)}</span>
            )}
          </div>
          {windows.releaseNotes && <p className="mb-4 text-sm text-ink-muted">{windows.releaseNotes}</p>}
          <a href={`/agent-download/${windows.id}/installer`}>
            <Button variant="primary">Baixar instalador (.exe)</Button>
          </a>
        </Panel>
      )}

      <Panel>
        <h2 className="mb-2 text-sm font-medium text-ink">Antes de instalar</h2>
        <p className="text-sm text-ink-muted">
          Durante a instalação, o assistente vai pedir o <strong>token do agente</strong> do cliente específico onde
          você está instalando. Gere um em{' '}
          <Link href="/customers" className="text-accent hover:underline">
            Clientes
          </Link>{' '}
          → escolha o cliente → seção de tokens do agente.
        </p>
      </Panel>
    </main>
  );
}
