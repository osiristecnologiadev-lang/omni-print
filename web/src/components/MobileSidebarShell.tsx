'use client';

import { useState } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { Logo } from '@/components/Logo';

function HamburgerIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M3 5.5h14M3 10h14M3 14.5h14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

// The sidebar was always a fixed w-56 column with no responsive behavior at
// all - fine on desktop, but on a real phone viewport it left ~150-165px
// for page content (found via UX audit, unverified on a real device before
// this fix). This is the one deliberate client-JS exception for the
// sidebar's mobile behavior (same precedent as ThemeToggle/GlobalSearch) -
// a pure-CSS checkbox-toggle hack was considered first but rejected because
// a `display:none` checkbox drops out of the keyboard tab order, breaking
// keyboard-only access to the toggle; a real <button> with aria-expanded
// doesn't have that problem.
//
// `<Link>` navigation in this app is a Next.js soft (client-side) route
// change, not a full page reload, so the open/closed state doesn't reset on
// its own the way it would with a pure-CSS/full-reload approach - closing
// on pathname change is handled below by adjusting state during render
// (the React-docs-recommended way to reset state when a derived value
// changes, rather than a useEffect - avoids the extra post-commit render).
export function MobileSidebarShell({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const [lastPathname, setLastPathname] = useState(pathname);

  if (pathname !== lastPathname) {
    setLastPathname(pathname);
    setOpen(false);
  }

  return (
    <>
      <div className="sticky top-0 z-30 flex items-center justify-between border-b border-line bg-surface px-4 py-3 lg:hidden">
        <Link href="/dashboard" className="flex items-center gap-2 transition-opacity hover:opacity-80">
          <Logo />
        </Link>
        <button
          type="button"
          aria-label={open ? 'Fechar menu' : 'Abrir menu'}
          aria-expanded={open}
          aria-controls="tenant-sidebar"
          onClick={() => setOpen((v) => !v)}
          className="rounded-lg p-2 text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink"
        >
          <HamburgerIcon />
        </button>
      </div>

      {open && (
        <button
          type="button"
          aria-label="Fechar menu"
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-30 bg-black/40 lg:hidden"
        />
      )}

      <aside
        id="tenant-sidebar"
        className={`fixed inset-y-0 left-0 z-40 flex h-screen w-56 shrink-0 flex-col overflow-y-auto border-r border-line bg-surface px-3 py-4 transition-transform duration-200 lg:sticky lg:top-0 lg:z-auto lg:translate-x-0 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {children}
      </aside>
    </>
  );
}
