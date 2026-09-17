'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
// Type-only - lib/api.ts itself must never be imported by value here (it
// pulls in next/headers at module scope, which Next refuses to bundle into
// client code). See search-index/route.ts, which is the actual data
// source for this component.
import type { Customer, Device, Ticket } from '@/lib/api';

interface SearchResult {
  type: 'Cliente' | 'Dispositivo' | 'Chamado';
  id: string;
  label: string;
  sublabel: string;
  href: string;
  haystack: string;
}

const MAX_PER_GROUP = 5;

function toResults(customers: Customer[], devices: Device[], tickets: Ticket[]): SearchResult[] {
  const fromCustomers: SearchResult[] = customers.map((c) => ({
    type: 'Cliente',
    id: c.id,
    label: c.name,
    sublabel: 'Cliente',
    href: `/customers/${c.id}`,
    haystack: c.name.toLowerCase(),
  }));
  const fromDevices: SearchResult[] = devices.map((d) => {
    const label = d.customLabel ?? d.printerName ?? d.name ?? d.host;
    return {
      type: 'Dispositivo',
      id: d.id,
      label,
      sublabel: d.customer?.name ?? 'Não atribuído',
      href: `/devices/${d.id}`,
      haystack: [label, d.host, d.serialNumber, d.customer?.name].filter(Boolean).join(' ').toLowerCase(),
    };
  });
  const fromTickets: SearchResult[] = tickets.map((t) => ({
    type: 'Chamado',
    id: t.id,
    label: t.subject,
    sublabel: t.customer.name,
    href: `/tickets/${t.id}`,
    haystack: [t.subject, t.customer.name].join(' ').toLowerCase(),
  }));
  return [...fromCustomers, ...fromDevices, ...fromTickets];
}

// Lazy-loaded, then filtered entirely client-side - same reasoning as
// DeviceFleetTable's own search: an MSP tenant's customers/devices/tickets
// are a few dozen to a few hundred rows total, small enough that one fetch
// on first focus beats a round trip per keystroke, and it means this can
// stay a plain in-memory filter with no debounce/loading-per-keystroke
// state to get wrong. Tenant-wide only (see the layout.tsx call site) - a
// customer-scoped session already has a much smaller nav with no need to
// jump across entities.
export function GlobalSearch() {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  function ensureLoaded() {
    if (results !== null || loadError) return;
    fetch('/search-index')
      .then((res) => {
        if (!res.ok) throw new Error(`search-index failed: ${res.status}`);
        return res.json();
      })
      .then((data: { customers: Customer[]; devices: Device[]; tickets: Ticket[] }) =>
        setResults(toResults(data.customers, data.devices, data.tickets)),
      )
      .catch(() => setLoadError(true));
  }

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || !results) return null;
    const matches = results.filter((r) => r.haystack.includes(q));
    const byType = { Cliente: [] as SearchResult[], Dispositivo: [] as SearchResult[], Chamado: [] as SearchResult[] };
    for (const r of matches) byType[r.type].push(r);
    return byType;
  }, [query, results]);

  const totalMatches = grouped ? grouped.Cliente.length + grouped.Dispositivo.length + grouped.Chamado.length : 0;

  function go(href: string) {
    setOpen(false);
    setQuery('');
    router.push(href);
  }

  return (
    <div ref={containerRef} className="relative px-2">
      <input
        type="text"
        aria-label="Buscar cliente, dispositivo ou chamado"
        value={query}
        onFocus={() => {
          ensureLoaded();
          setOpen(true);
        }}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setOpen(false);
            (e.target as HTMLInputElement).blur();
          }
          if (e.key === 'Enter' && grouped) {
            const first = grouped.Cliente[0] ?? grouped.Dispositivo[0] ?? grouped.Chamado[0];
            if (first) go(first.href);
          }
        }}
        placeholder="Buscar cliente, dispositivo, chamado..."
        className="w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink outline-none transition-colors placeholder:text-ink-faint focus:border-accent"
      />

      {open && query.trim() && (
        <div className="absolute left-2 right-2 top-full z-20 mt-1 max-h-96 overflow-y-auto rounded-lg border border-line bg-surface shadow-lg">
          {loadError ? (
            <p className="p-3 text-sm text-ink-faint">Não foi possível carregar a busca.</p>
          ) : !results ? (
            <p className="p-3 text-sm text-ink-faint">Carregando...</p>
          ) : totalMatches === 0 ? (
            <p className="p-3 text-sm text-ink-faint">Nenhum resultado para &quot;{query}&quot;.</p>
          ) : (
            (['Cliente', 'Dispositivo', 'Chamado'] as const).map((type) =>
              grouped![type].length === 0 ? null : (
                <div key={type} className="border-b border-line py-1 last:border-b-0">
                  <p className="px-3 pt-1 text-[11px] font-medium uppercase tracking-wide text-ink-faint">{type}s</p>
                  {grouped![type].slice(0, MAX_PER_GROUP).map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => go(r.href)}
                      className="flex w-full flex-col items-start px-3 py-1.5 text-left text-sm transition-colors hover:bg-surface-2"
                    >
                      <span className="text-ink">{r.label}</span>
                      <span className="text-xs text-ink-faint">{r.sublabel}</span>
                    </button>
                  ))}
                </div>
              ),
            )
          )}
        </div>
      )}
    </div>
  );
}
