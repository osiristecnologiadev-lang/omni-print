import { getAgentFleet, getAgentReleases } from '@/lib/platform-api';
import { getViewerTimeZone } from '@/lib/api';
import { AgentFleetList } from './AgentFleetList';

export default async function AgentFleetPage() {
  const [fleet, releases, tz] = await Promise.all([getAgentFleet(), getAgentReleases(), getViewerTimeZone()]);

  const latestByPlatform = new Map<string, string>();
  for (const r of releases) {
    // releases are already ordered newest-first by createdAt (see
    // AgentReleasesService.list) - first match per platform is enough,
    // though createdAt order can in principle differ from version order if
    // an old version was ever republished, which is fine for this
    // best-effort "is this behind?" hint.
    if (!latestByPlatform.has(r.platform)) {
      latestByPlatform.set(r.platform, r.version);
    }
  }

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <h1 className="mb-1 text-2xl font-semibold text-gray-100">Frota de agentes</h1>
      <p className="mb-6 text-sm text-gray-400">
        Qual versão do agente cada token reporta na última checagem de atualização (ver{' '}
        <code>agent/internal/updater</code>). Tokens revogados não aparecem aqui.
      </p>

      {fleet.length === 0 ? (
        <p className="rounded-xl border border-dashed border-gray-700 p-8 text-center text-gray-500">
          Nenhum agente fez check-in ainda.
        </p>
      ) : (
        <AgentFleetList fleet={fleet} tz={tz} />
      )}

      {latestByPlatform.size > 0 && (
        <p className="mt-4 text-xs text-gray-500">
          Última release publicada: {[...latestByPlatform.entries()].map(([p, v]) => `${p} v${v}`).join(' · ')}
        </p>
      )}
    </main>
  );
}
