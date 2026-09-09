'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { LogoMark } from '@/components/Logo';
import { buttonClasses } from '@/components/Button';

// Catches any otherwise-unhandled error thrown while rendering a page inside
// the (tenant) route group. Without this, Next falls back to its built-in
// generic error page - which renders *outside* the root layout entirely, so
// the app's fonts/tokens/light-dark choice never apply (looks broken, and a
// stored light theme appears to "revert" to dark since the beforeInteractive
// theme-init script in layout.tsx never runs for that fallback page). Having
// this boundary keeps a crash inside the normal tree instead.
export default function TenantError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3 bg-paper px-6 text-center">
      <LogoMark size={28} />
      <h1 className="mt-2 text-2xl font-semibold text-ink">Algo deu errado</h1>
      <p className="max-w-sm text-sm text-ink-muted">
        Não foi possível carregar esta página. Tente novamente - se o problema continuar, avise o suporte.
      </p>
      <div className="mt-2 flex items-center gap-4">
        <button onClick={() => reset()} className={buttonClasses('primary')}>
          Tentar novamente
        </button>
        <Link href="/dashboard" className="text-sm font-medium text-accent hover:underline">
          Ir para o início
        </Link>
      </div>
    </main>
  );
}
