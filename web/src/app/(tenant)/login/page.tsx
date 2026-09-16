import Link from 'next/link';
import { Logo } from '@/components/Logo';
import { ThemeToggle } from '@/components/ThemeToggle';
import { SubmitButton } from '@/components/SubmitButton';
import { Banner } from '@/components/Banner';
import { loginAction } from './actions';

const inputClass =
  'mb-4 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none transition-colors focus:border-accent';

export default async function LoginPage(props: PageProps<'/login'>) {
  const searchParams = await props.searchParams;
  const hasError = searchParams?.error === '1';
  const justReset = searchParams?.reset === '1';

  return (
    <main className="relative flex min-h-screen items-center justify-center bg-paper px-6">
      <div className="absolute top-6 right-6">
        <ThemeToggle />
      </div>
      <div className="w-full max-w-sm">
        <div className="mb-6 flex justify-center">
          <Logo size={22} />
        </div>
        <form action={loginAction} className="rounded-xl border border-line bg-surface p-8 shadow-sm shadow-ink/[0.03]">
          <h1 className="mb-1 text-lg font-semibold text-ink">Entrar</h1>
          <p className="mb-6 text-sm text-ink-muted">Acompanhe o parque de impressoras que você atende.</p>

          {hasError && <Banner tone="error">E-mail ou senha inválidos.</Banner>}
          {justReset && <Banner tone="success">Senha redefinida com sucesso. Entre com a nova senha.</Banner>}

          <label className="mb-1 block text-sm font-medium text-ink" htmlFor="email">
            E-mail
          </label>
          <input id="email" name="email" type="email" required autoFocus className={inputClass} />

          <div className="mb-1 flex items-center justify-between">
            <label className="block text-sm font-medium text-ink" htmlFor="password">
              Senha
            </label>
            <Link href="/forgot-password" className="text-xs text-accent hover:underline">
              Esqueci minha senha
            </Link>
          </div>
          <input
            id="password"
            name="password"
            type="password"
            required
            className={`${inputClass} mb-6`}
          />

          <SubmitButton variant="primary" className="w-full" pendingLabel="Entrando...">
            Entrar
          </SubmitButton>
        </form>
      </div>
    </main>
  );
}
