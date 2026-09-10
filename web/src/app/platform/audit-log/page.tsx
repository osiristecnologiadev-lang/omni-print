import Link from 'next/link';
import { getPlatformAuditLog } from '@/lib/platform-api';
import { getViewerTimeZone } from '@/lib/api';

// Server Components render on Railway (UTC) - see getViewerTimeZone.
function formatDateTime(iso: string, timeZone?: string): string {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone }).format(new Date(iso));
}

const ACTION_LABEL: Record<string, string> = {
  'platform.create_tenant': 'Tenant criado',
  'platform.create_tenant_user': 'Usuário criado para um tenant',
  'agent_release.publish': 'Release do agente publicado',
  'agent_release.delete': 'Release do agente removido',
};

function actionLabel(action: string): string {
  return ACTION_LABEL[action] ?? action;
}

export default async function PlatformAuditLogPage(props: PageProps<'/platform/audit-log'>) {
  const searchParams = await props.searchParams;
  const cursor = typeof searchParams?.cursor === 'string' ? searchParams.cursor : undefined;
  const [page, tz] = await Promise.all([getPlatformAuditLog(cursor), getViewerTimeZone()]);

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="mb-1 text-2xl font-semibold text-gray-100">Log de auditoria</h1>
      <p className="mb-6 text-sm text-gray-400">
        Ações da própria equipe OmniPrint - criar um tenant, publicar ou remover uma release do agente. Ações de
        um tenant sobre os próprios dados (revogar token, reatribuir dispositivo, etc.) ficam no log de auditoria
        de cada tenant, não aqui.
      </p>

      {page.entries.length === 0 ? (
        <p className="rounded-xl border border-dashed border-gray-700 p-8 text-center text-gray-500">
          Nenhuma ação registrada ainda.
        </p>
      ) : (
        <ul className="divide-y divide-gray-800 rounded-xl border border-gray-800 bg-gray-900/40">
          {page.entries.map((e) => (
            <li key={e.id} className="px-4 py-3">
              <div className="mb-1 flex items-center justify-between gap-3">
                <span className="font-medium text-gray-100">{actionLabel(e.action)}</span>
                <span className="shrink-0 text-xs text-gray-500">{formatDateTime(e.createdAt, tz)}</span>
              </div>
              <p className="text-sm text-gray-400">
                {e.actorLabel ?? 'ator desconhecido'}
                {e.targetLabel && <> · {e.targetLabel}</>}
              </p>
            </li>
          ))}
        </ul>
      )}

      {page.nextCursor && (
        <div className="mt-4 text-center">
          <Link
            href={`/platform/audit-log?cursor=${encodeURIComponent(page.nextCursor)}`}
            className="text-sm text-amber-500 hover:underline"
          >
            Carregar mais
          </Link>
        </div>
      )}
    </main>
  );
}
