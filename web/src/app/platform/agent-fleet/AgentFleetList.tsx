'use client';

import { useMemo, useState } from 'react';
import type { AgentFleetEntry } from '@/lib/platform-api';

const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

const STATUS_OPTIONS = [
  { value: 'all', label: 'Todos' },
  { value: 'stale', label: 'Só desatualizados' },
  { value: 'never', label: 'Nunca fez check-in' },
] as const;

type StatusFilter = (typeof STATUS_OPTIONS)[number]['value'];

const fieldClass =
  'rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 outline-none transition-colors focus:border-amber-600';

// Same instant client-side filter reasoning as TenantList.tsx (../TenantList.tsx) -
// small enough dataset (one row per active agent token) that filtering the
// already-fetched array in memory beats a round trip per keystroke.
export function AgentFleetList({ fleet, tz }: { fleet: AgentFleetEntry[]; tz?: string }) {
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  function formatDateTime(iso: string): string {
    return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: tz }).format(new Date(iso));
  }

  const rows = useMemo(() => {
    return fleet
      .map((entry) => ({
        entry,
        stale: !entry.lastCheckinAt || Date.now() - new Date(entry.lastCheckinAt).getTime() > STALE_AFTER_MS,
      }))
      .filter(({ entry, stale }) => {
        const q = query.trim().toLowerCase();
        if (q) {
          const haystack = [entry.tenant.name, entry.customer?.name, entry.label]
            .filter(Boolean)
            .join(' ')
            .toLowerCase();
          if (!haystack.includes(q)) return false;
        }
        if (statusFilter === 'stale' && !stale) return false;
        if (statusFilter === 'never' && entry.lastCheckinAt) return false;
        return true;
      });
  }, [fleet, query, statusFilter]);

  const hasActiveFilter = query !== '' || statusFilter !== 'all';

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar por empresa, cliente ou token..."
          className={`min-w-[220px] flex-1 ${fieldClass}`}
        />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StatusFilter)} className={fieldClass}>
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
      {hasActiveFilter && (
        <p className="mb-2 text-xs text-gray-500">
          {rows.length} de {fleet.length} agente{fleet.length === 1 ? '' : 's'}
        </p>
      )}

      {rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-gray-700 p-8 text-center text-gray-500">
          Nenhum agente encontrado com esses filtros.
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
              {rows.map(({ entry, stale }) => (
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
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
