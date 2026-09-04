import { getAgentFleet, getAgentReleases } from '@/lib/platform-api';

function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso));
}

// "Stale" here just means "hasn't checked in within roughly 2 update-check
// cycles at the default 6h interval" - a rough signal for the operator to
// investigate (offline machine, blocked outbound traffic, uninstalled
// agent), not a hard SLA.
const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

export default async function AgentFleetPage() {
  const [fleet, releases] = await Promise.all([getAgentFleet(), getAgentReleases()]);

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
        <div className="overflow-x-auto rounded-xl border border-gray-800 bg-gray-900/40">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-800 text-left text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-2">Tenant</th>
                <th className="px-4 py-2">Cliente</th>
                <th className="px-4 py-2">Token</th>
                <th className="px-4 py-2">Versão</th>
                <th className="px-4 py-2">Último check-in</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {fleet.map((entry) => {
                const stale =
                  !entry.lastCheckinAt || Date.now() - new Date(entry.lastCheckinAt).getTime() > STALE_AFTER_MS;
                return (
                  <tr key={entry.id}>
                    <td className="px-4 py-2 text-gray-200">{entry.tenant.name}</td>
                    <td className="px-4 py-2 text-gray-400">{entry.customer?.name ?? '—'}</td>
                    <td className="px-4 py-2 text-gray-400">{entry.label ?? entry.id.slice(0, 8)}</td>
                    <td className="px-4 py-2">
                      {entry.lastSeenVersion ? (
                        <span className="text-gray-200">v{entry.lastSeenVersion}</span>
                      ) : (
                        <span className="text-gray-600">nunca</span>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      <span className={stale ? 'text-red-400' : 'text-gray-400'}>
                        {entry.lastCheckinAt ? formatDateTime(entry.lastCheckinAt) : 'nunca'}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {latestByPlatform.size > 0 && (
        <p className="mt-4 text-xs text-gray-500">
          Última release publicada: {[...latestByPlatform.entries()].map(([p, v]) => `${p} v${v}`).join(' · ')}
        </p>
      )}
    </main>
  );
}
