import { getAgentReleases } from '@/lib/platform-api';
import { publishAgentReleaseAction, deleteAgentReleaseAction } from './actions';

function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso));
}

function formatBytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${(bytes / 1024).toFixed(0)} KB`;
}

export default async function AgentReleasesPage() {
  const releases = await getAgentReleases();

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="mb-1 text-2xl font-semibold text-gray-100">Releases do agente</h1>
      <p className="mb-6 text-sm text-gray-400">
        Publique aqui uma nova versão do binário do agente. Agentes já instalados checam esta lista sozinhos
        (ver <code>internal/updater</code> em <code>agent/</code>) e aplicam a mais nova automaticamente, a não
        ser que <code>auto_update.enabled</code> esteja desligado no <code>config.yaml</code> do cliente e a
        release não esteja marcada como obrigatória.
      </p>

      <form
        action={publishAgentReleaseAction}
        encType="multipart/form-data"
        className="mb-8 space-y-3 rounded-xl border border-gray-800 bg-gray-900/40 p-4"
      >
        <div className="grid grid-cols-2 gap-3">
          <label className="text-sm text-gray-400">
            Plataforma
            <select
              name="platform"
              required
              className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 outline-none focus:border-amber-600"
            >
              <option value="WINDOWS">Windows</option>
              <option value="LINUX">Linux</option>
            </select>
          </label>
          <label className="text-sm text-gray-400">
            Versão (major.minor.patch)
            <input
              name="version"
              placeholder="0.2.0"
              required
              pattern="\d+\.\d+\.\d+"
              className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 outline-none focus:border-amber-600"
            />
          </label>
        </div>

        <label className="block text-sm text-gray-400">
          Binário (<code>omniprint-agent.exe</code> ou <code>omniprint-agent</code> - o executável puro, não o
          instalador)
          <input
            type="file"
            name="file"
            required
            className="mt-1 block w-full text-sm text-gray-300 file:mr-3 file:rounded-lg file:border-0 file:bg-amber-600 file:px-3 file:py-1.5 file:text-white"
          />
        </label>

        <label className="block text-sm text-gray-400">
          Notas da release (opcional)
          <textarea
            name="releaseNotes"
            rows={2}
            className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 outline-none focus:border-amber-600"
          />
        </label>

        <label className="flex items-center gap-2 text-sm text-gray-300">
          <input type="checkbox" name="mandatory" value="true" className="accent-amber-600" />
          Obrigatória (aplica mesmo em instalações com auto_update desligado)
        </label>

        <button
          type="submit"
          className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-amber-500"
        >
          Publicar release
        </button>
      </form>

      {releases.length === 0 ? (
        <p className="rounded-xl border border-dashed border-gray-700 p-8 text-center text-gray-500">
          Nenhuma release publicada ainda.
        </p>
      ) : (
        <ul className="divide-y divide-gray-800 rounded-xl border border-gray-800 bg-gray-900/40">
          {releases.map((r) => (
            <li key={r.id} className="flex items-start justify-between gap-4 px-4 py-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-gray-800 px-2 py-0.5 text-xs font-medium text-gray-300">
                    {r.platform === 'WINDOWS' ? 'Windows' : 'Linux'}
                  </span>
                  <span className="font-medium text-gray-100">v{r.version}</span>
                  {r.mandatory && (
                    <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-xs font-medium text-red-400">
                      obrigatória
                    </span>
                  )}
                </div>
                {r.releaseNotes && <p className="mt-1 text-sm text-gray-400">{r.releaseNotes}</p>}
                <div className="mt-1 text-xs text-gray-500">
                  {formatBytes(r.fileSizeBytes)} · publicada em {formatDateTime(r.createdAt)} · sha256{' '}
                  {r.sha256.slice(0, 12)}…
                </div>
              </div>
              <form action={deleteAgentReleaseAction.bind(null, r.id)}>
                <button type="submit" className="text-sm text-gray-500 transition-colors hover:text-red-400">
                  Remover
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
