'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { StatusBadge } from './StatusBadge';
import type { Health } from '@/lib/health';
import type { Device } from '@/lib/api';
import { displayPageCount, engineDisplayPageCount } from '@/lib/pages';

export interface DeviceRow extends Device {
  health: Health;
}

function formatPageCount(value: number | null): string {
  if (value == null) return '—';
  return new Intl.NumberFormat('pt-BR').format(value);
}

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
export function DeviceFleetTable({ devices, isTenantWide }: { devices: DeviceRow[]; isTenantWide: boolean }) {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return devices;
    return devices.filter((d) => {
      const haystack = [
        d.customLabel,
        d.printerName,
        d.name,
        d.host,
        d.serialNumber,
        d.customer?.name,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [devices, query]);

  return (
    <div className="overflow-hidden rounded-xl border border-line bg-surface">
      <div className="border-b border-line p-3">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar por nome, apelido, IP ou número de série..."
          className="w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink outline-none transition-colors placeholder:text-ink-faint focus:border-accent"
        />
        {query && (
          <p className="mt-2 text-xs text-ink-faint">
            {filtered.length} de {devices.length} dispositivo{devices.length === 1 ? '' : 's'}
          </p>
        )}
      </div>

      {filtered.length === 0 ? (
        <p className="p-6 text-center text-sm text-ink-faint">Nenhum dispositivo encontrado para &quot;{query}&quot;.</p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead className="bg-surface-2 text-xs uppercase tracking-wide text-ink-muted">
            <tr>
              <th className="px-4 py-3 font-medium">Dispositivo</th>
              <th className="px-4 py-3 font-medium">IP</th>
              <th className="px-4 py-3 font-medium">Nº de série</th>
              {isTenantWide && <th className="px-4 py-3 font-medium">Cliente</th>}
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Páginas</th>
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
                      {device.customLabel && (device.printerName ?? device.name) && (
                        <div className="text-xs text-ink-faint">{device.printerName ?? device.name}</div>
                      )}
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
                  <td className="px-4 py-3 text-ink-muted">
                    {device.latestMetric ? formatRelativeTime(device.latestMetric.collected_at) : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
