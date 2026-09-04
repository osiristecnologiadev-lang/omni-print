import Link from 'next/link';
import { LogoMark } from '@/components/Logo';

export default function Forbidden() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3 bg-paper px-6 text-center">
      <LogoMark size={28} />
      <h1 className="mt-2 text-2xl font-semibold text-ink">Acesso restrito</h1>
      <p className="max-w-sm text-sm text-ink-muted">
        Sua conta está vinculada a um cliente específico e não tem acesso a esta página.
      </p>
      <Link href="/" className="mt-2 text-sm font-medium text-accent hover:underline">
        Voltar ao parque de impressoras
      </Link>
    </main>
  );
}
