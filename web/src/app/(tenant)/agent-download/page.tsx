import Link from 'next/link';
import { forbidden } from 'next/navigation';
import { getViewerAccess, getAgentLatestRelease } from '@/lib/api';
import { hasPermission } from '@/lib/permissions';
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
  const access = await getViewerAccess();
  if (!hasPermission(access, 'agent')) {
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
        <p className="mb-3 text-sm text-ink-muted">
          O assistente de instalação vai pedir um único dado: o código de instalação.
        </p>
        <p className="text-sm text-ink-muted">
          Gere um código específico para o cliente onde você está instalando, em{' '}
          <Link href="/customers" className="text-accent hover:underline">
            Clientes
          </Link>{' '}
          → escolha o cliente → seção &ldquo;Códigos de instalação do agente&rdquo;. O código vale por 24
          horas e só funciona uma vez — envie-o para quem for rodar o instalador; o assistente troca esse
          código pelos dados reais sozinho.
        </p>
        <p className="mt-3 text-xs text-ink-faint">
          Instalação manual (avançado): se a máquina de destino não tiver acesso à internet no momento da
          instalação, o assistente oferece um modo manual com Tenant ID, token e URL da API — gere um token
          de agente na mesma tela do cliente, seção &ldquo;Tokens de agente (avançado)&rdquo;.
        </p>
      </Panel>
    </main>
  );
}
