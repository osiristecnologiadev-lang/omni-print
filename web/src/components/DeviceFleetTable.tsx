'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { StatusBadge } from './StatusBadge';
import type { Health, HealthTone } from '@/lib/health';
import type { Customer, Device } from '@/lib/api';
import { displayPageCount, engineDisplayPageCount } from '@/lib/pages';

const STATUS_FILTER_OPTIONS: Array<{ value: HealthTone | 'all'; label: string }> = [
  { value: 'all', label: 'Todos os status' },
  { value: 'ok', label: 'Normal' },
  { value: 'warning', label: 'Atenção' },
  { value: 'critical', label: 'Crítico' },
  { value: 'neutral', label: 'Sem dados' },
];

const selectClass =
  'rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink outline-none transition-colors focus:border-accent';

export interface DeviceRow extends Device {
  health: Health;
}

function formatPageCount(value: number | null): string {
  if (value == null) return '—';
  return new Intl.NumberFormat('pt-BR').format(value);
}

const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

function formatRelativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(diffMs / 60000);
  if (minutes < 1) return 'agora mesmo';
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `há ${hours} h`;
  return `há ${Math.round(hours / 24)} d`;
}

// Instant client-side filter - the fleet list is a few dozen to a few
// hundred devices per tenant, small enough that shipping the already-fetched
// array to the client and filtering in memory beats a round trip per
// keystroke. Deliberate exception to this app's "no client JS" default
// (same reasoning as ThemeToggle/ContractForm) - typing to search is
// inherently an interactive action.
export function DeviceFleetTable({
  devices,
  isTenantWide,
  revenueByDeviceId,
  customers,
  showStatusFilter,
}: {
  devices: DeviceRow[];
  isTenantWide: boolean;
  // Estimated usage-revenue for the current billing period, keyed by
  // device id - omitted entirely (column doesn't render) rather than
  // passed as all-zero when there's no active contract, or the contract
  // is FLAT_RATE (whose fee isn't usage-based, so "R$0,00 por impressora"
  // would misleadingly read as "this printer earns nothing" instead of
  // "not applicable"). See ContractsService's allocateUsageRevenue for why
  // this is an estimate, not a literal per-device bill.
  revenueByDeviceId?: Map<string, number>;
  // Only the dedicated /devices page passes these two - the dashboard and
  // a single customer's own device list don't need "which customer" (the
  // customer page is already scoped to one) or a status breakdown (the
  // dashboard already has its own stat tiles for that).
  customers?: Customer[];
  showStatusFilter?: boolean;
}) {
  const [query, setQuery] = useState('');
  const [customerFilter, setCustomerFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<HealthTone | 'all'>('all');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return devices.filter((d) => {
      if (q) {
        const haystack = [d.customLabel, d.printerName, d.name, d.host, d.serialNumber, d.customer?.name]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      if (customerFilter === 'unassigned' && d.customerId != null) return false;
      if (customerFilter !== 'all' && customerFilter !== 'unassigned' && d.customerId !== customerFilter) return false;
      if (statusFilter !== 'all') {
        const matches = statusFilter === 'ok' ? d.health.tone === 'ok' || d.health.tone === 'info' : d.health.tone === statusFilter;
        if (!matches) return false;
      }
      return true;
    });
  }, [devices, query, customerFilter, statusFilter]);

  const hasActiveFilter = query || customerFilter !== 'all' || statusFilter !== 'all';

  return (
    <div className="overflow-hidden rounded-xl border border-line bg-surface">
      <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar por nome, apelido, IP ou número de série..."
          className="min-w-[220px] flex-1 rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink outline-none transition-colors placeholder:text-ink-faint focus:border-accent"
        />
        {customers && isTenantWide && (
          <select
            value={customerFilter}
            onChange={(e) => setCustomerFilter(e.target.value)}
            className={selectClass}
          >
            <option value="all">Todos os clientes</option>
            <option value="unassigned">Não atribuído</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        )}
        {showStatusFilter && (
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as HealthTone | 'all')}
            className={selectClass}
          >
            {STATUS_FILTER_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        )}
        {hasActiveFilter && (
          <p className="w-full text-xs text-ink-faint">
            {filtered.length} de {devices.length} dispositivo{devices.length === 1 ? '' : 's'}
          </p>
        )}
      </div>

      {filtered.length === 0 ? (
        <p className="p-6 text-center text-sm text-ink-faint">
          {query ? <>Nenhum dispositivo encontrado para &quot;{query}&quot;.</> : 'Nenhum dispositivo encontrado com esses filtros.'}
        </p>
      ) : (
        // Wide tables (many columns, or a narrow viewport) scroll inside
        // this container instead of getting clipped by the outer
        // overflow-hidden (which exists only to round the card's corners).
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-surface-2 text-xs uppercase tracking-wide text-ink-muted">
              <tr>
                <th className="px-4 py-3 font-medium">Dispositivo</th>
                <th className="px-4 py-3 font-medium">IP</th>
                <th className="px-4 py-3 font-medium">Nº de série</th>
                {isTenantWide && <th className="px-4 py-3 font-medium">Cliente</th>}
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Páginas</th>
                {revenueByDeviceId && <th className="px-4 py-3 font-medium">Receita (mês)</th>}
                <th className="px-4 py-3 font-medium">Atualizado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {filtered.map((device) => {
                const pages = displayPageCount(device.latestMetric);
                const enginePages = engineDisplayPageCount(device.latestMetric);
                const hasSplit = enginePages != null && pages !== enginePages;
                return (
                  <tr key={device.id} className="transition-colors hover:bg-surface-2">
                    <td className="px-4 py-3">
                      <Link href={`/devices/${device.id}`} className="block">
                        <div className="font-medium text-ink">
                          {device.customLabel ?? device.printerName ?? device.name ?? device.host}
                        </div>
                        <div className="text-xs text-ink-faint">
                          Apelido: {device.customLabel ?? '—'} · Nome: {device.printerName ?? device.name ?? device.host}
                        </div>
                      </Link>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-ink-muted">{device.host}</td>
                    <td className="px-4 py-3 font-mono text-xs text-ink-muted">{device.serialNumber ?? '—'}</td>
                    {isTenantWide && (
                      <td className="px-4 py-3 text-ink-muted">
                        {device.customer?.name ?? <span className="text-ink-faint">—</span>}
                      </td>
                    )}
                    <td className="px-4 py-3">
                      <StatusBadge health={device.health} />
                    </td>
                    <td className="px-4 py-3 tabular-nums text-ink-muted">
                      {formatPageCount(pages)}
                      {hasSplit && (
                        <div className="text-xs text-ink-faint">mecanismo: {formatPageCount(enginePages)}</div>
                      )}
                    </td>
                    {revenueByDeviceId && (
                      <td className="px-4 py-3 tabular-nums text-ink-muted">
                        ≈ {currency.format(revenueByDeviceId.get(device.id) ?? 0)}
                      </td>
                    )}
                    <td className="px-4 py-3 text-ink-muted">
                      {device.latestMetric ? formatRelativeTime(device.latestMetric.collected_at) : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
