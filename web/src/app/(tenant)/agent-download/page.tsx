import Link from 'next/link';
import { forbidden } from 'next/navigation';
import { getSession, getAgentLatestRelease, getTenant } from '@/lib/api';
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

  const [windows, tenant] = await Promise.all([getAgentLatestRelease('WINDOWS'), getTenant()]);

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
          O assistente de instalação vai pedir 3 dados:
        </p>
        <dl className="space-y-3 text-sm">
          <div>
            <dt className="text-ink-muted">Tenant ID</dt>
            <dd className="mt-0.5 select-all rounded-md bg-surface-2 px-2 py-1 font-mono text-xs text-ink">
              {tenant.id}
            </dd>
          </div>
          <div>
            <dt className="text-ink-muted">URL da API</dt>
            <dd className="mt-0.5 select-all rounded-md bg-surface-2 px-2 py-1 font-mono text-xs text-ink">
              {process.env.API_BASE_URL ?? 'http://localhost:3000'}
            </dd>
          </div>
          <div>
            <dt className="text-ink-muted">
              Token do agente — gere um específico para o cliente onde você está instalando, em{' '}
              <Link href="/customers" className="text-accent hover:underline">
                Clientes
              </Link>{' '}
              → escolha o cliente → seção de tokens do agente. Ele só é exibido uma vez.
            </dt>
          </div>
        </dl>
      </Panel>
    </main>
  );
}
