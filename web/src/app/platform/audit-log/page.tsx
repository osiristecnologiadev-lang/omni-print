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
  'platform.update_tenant_pricing': 'Preço negociado do tenant alterado',
  'agent_release.publish': 'Release do agente publicado',
  'agent_release.delete': 'Release do agente removido',
};

function actionLabel(action: string): string {
  return ACTION_LABEL[action] ?? action;
}

const TARGET_TYPE_LABEL: Record<string, string> = {
  Tenant: 'Tenant',
  User: 'Usuário',
  AgentRelease: 'Release do agente',
};

const selectClass = 'rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 outline-none focus:border-amber-500';

export default async function PlatformAuditLogPage(props: PageProps<'/platform/audit-log'>) {
  const searchParams = await props.searchParams;
  const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
  const cursor = str(searchParams?.cursor);
  const action = str(searchParams?.action);
  const targetType = str(searchParams?.targetType);
  const from = str(searchParams?.from);
  const to = str(searchParams?.to);

  const [page, tz] = await Promise.all([
    getPlatformAuditLog({ cursor, action, targetType, from, to }),
    getViewerTimeZone(),
  ]);

  const filterParams = new URLSearchParams();
  if (action) filterParams.set('action', action);
  if (targetType) filterParams.set('targetType', targetType);
  if (from) filterParams.set('from', from);
  if (to) filterParams.set('to', to);

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="mb-1 text-2xl font-semibold text-gray-100">Log de auditoria</h1>
      <p className="mb-6 text-sm text-gray-400">
        Ações da própria equipe OmniPrint - criar um tenant, publicar ou remover uma release do agente. Ações de
        um tenant sobre os próprios dados (revogar token, reatribuir dispositivo, etc.) ficam no log de auditoria
        de cada tenant, não aqui.
      </p>

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
        <label className="flex items-center gap-1.5 text-sm text-gray-400">
          De
          <input type="date" name="from" defaultValue={from ?? ''} className={selectClass} />
        </label>
        <label className="flex items-center gap-1.5 text-sm text-gray-400">
          Até
          <input type="date" name="to" defaultValue={to ?? ''} className={selectClass} />
        </label>
        <button
          type="submit"
          className="rounded-lg border border-amber-600/60 bg-amber-600/10 px-3 py-2 text-sm text-amber-400 hover:bg-amber-600/20"
        >
          Filtrar
        </button>
        {(action || targetType || from || to) && (
          <Link href="/platform/audit-log" className="text-sm text-amber-500 hover:underline">
            Limpar filtros
          </Link>
        )}
      </form>

      {page.entries.length === 0 ? (
        <p className="rounded-xl border border-dashed border-gray-700 p-8 text-center text-gray-500">
          {action || targetType || from || to
            ? 'Nenhuma ação encontrada com esses filtros.'
            : 'Nenhuma ação registrada ainda.'}
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
            href={`/platform/audit-log?${new URLSearchParams({ ...Object.fromEntries(filterParams), cursor: page.nextCursor }).toString()}`}
            className="text-sm text-amber-500 hover:underline"
          >
            Carregar mais
          </Link>
        </div>
      )}
    </main>
  );
}
