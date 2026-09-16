'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import type { Tenant } from '@/lib/platform-api';

const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

// Raw Tailwind classes, not the tenant app's design tokens - matches the
// rest of this always-dark platform area (see platform/layout.tsx).
const STATUS_CLASSES: Record<string, string> = {
  TRIALING: 'bg-sky-900/40 text-sky-300',
  ACTIVE: 'bg-emerald-900/40 text-emerald-300',
  PAST_DUE: 'bg-amber-900/40 text-amber-300',
  CANCELED: 'bg-red-900/40 text-red-300',
};
const STATUS_LABEL: Record<string, string> = {
  TRIALING: 'Teste',
  ACTIVE: 'Ativo',
  PAST_DUE: 'Pagamento pendente',
  CANCELED: 'Cancelado',
};

const SORT_OPTIONS = [
  { value: 'name', label: 'Nome (A-Z)' },
  { value: 'recent', label: 'Mais recentes primeiro' },
  { value: 'mrr', label: 'Maior MRR primeiro' },
  { value: 'devices', label: 'Mais dispositivos primeiro' },
] as const;

type SortKey = (typeof SORT_OPTIONS)[number]['value'];

const fieldClass =
  'rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 outline-none transition-colors focus:border-amber-600';

// Instant client-side filter/sort - this project's own tenant list is a
// few dozen entries today (own daily-ops usage, see the UX-audit finding
// this closes), small enough that filtering the already-fetched array in
// memory beats a round trip per keystroke. Same reasoning/precedent as
// DeviceFleetTable.tsx.
export function TenantList({ tenants, tz }: { tenants: Tenant[]; tz?: string }) {
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sortKey, setSortKey] = useState<SortKey>('name');

  function formatDateTime(iso: string): string {
    return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeZone: tz }).format(new Date(iso));
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const result = tenants.filter((t) => {
      if (q && !t.name.toLowerCase().includes(q)) return false;
      if (statusFilter === 'comp') return t.pricePerDeviceCentsOverride === 0;
      if (statusFilter !== 'all' && t.subscriptionStatus !== statusFilter) return false;
      return true;
    });
    return [...result].sort((a, b) => {
      switch (sortKey) {
        case 'recent':
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        case 'mrr':
          return b.mrrCents - a.mrrCents;
        case 'devices':
          return (b._count?.devices ?? 0) - (a._count?.devices ?? 0);
        default:
          return a.name.localeCompare(b.name, 'pt-BR');
      }
    });
  }, [tenants, query, statusFilter, sortKey]);

  const hasActiveFilter = query !== '' || statusFilter !== 'all';

  return (
    <>
      <div className="mt-6 flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar por nome da empresa..."
          className={`min-w-[220px] flex-1 ${fieldClass}`}
        />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className={fieldClass}>
          <option value="all">Todos os status</option>
          <option value="TRIALING">Teste</option>
          <option value="ACTIVE">Ativo</option>
          <option value="PAST_DUE">Pagamento pendente</option>
          <option value="CANCELED">Cancelado</option>
          <option value="comp">Cortesia</option>
        </select>
        <select value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)} className={fieldClass}>
          {SORT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
      {hasActiveFilter && (
        <p className="mt-2 text-xs text-gray-500">
          {filtered.length} de {tenants.length} empresa{tenants.length === 1 ? '' : 's'}
        </p>
      )}

      {filtered.length === 0 ? (
        <p className="mt-6 rounded-xl border border-dashed border-gray-700 p-8 text-center text-gray-500">
          Nenhuma empresa encontrada com esses filtros.
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-gray-800 rounded-xl border border-gray-800 bg-gray-900/40">
          {filtered.map((t) => (
            <li key={t.id} className="flex items-center justify-between px-4 py-3">
              <div>
                <Link href={`/platform/tenants/${t.id}`} className="font-medium text-gray-100 hover:text-amber-400">
                  {t.name}
                </Link>
                <div className="text-xs text-gray-500">desde {formatDateTime(t.createdAt)}</div>
              </div>
              <div className="flex items-center gap-3">
                <div className="text-right text-sm text-gray-400">
                  {t._count?.customers ?? 0} cliente{(t._count?.customers ?? 0) === 1 ? '' : 's'} ·{' '}
                  {t._count?.devices ?? 0} dispositivo{(t._count?.devices ?? 0) === 1 ? '' : 's'} ·{' '}
                  {t._count?.users ?? 0} usuário{(t._count?.users ?? 0) === 1 ? '' : 's'}
                  {t.subscriptionStatus === 'ACTIVE' && (
                    <span className="ml-1 tabular-nums text-gray-500">· {currency.format(t.mrrCents / 100)}/mês</span>
                  )}
                </div>
                {t.pricePerDeviceCentsOverride === 0 ? (
                  <span className="inline-flex items-center rounded-full bg-emerald-900/40 px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap text-emerald-300">
                    Cortesia
                  </span>
                ) : (
                  <span
                    className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ${STATUS_CLASSES[t.subscriptionStatus]}`}
                  >
                    {STATUS_LABEL[t.subscriptionStatus]}
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
