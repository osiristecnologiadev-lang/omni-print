import { Logo } from '@/components/Logo';
import { ThemeToggle } from '@/components/ThemeToggle';
import { loginAction } from './actions';

const inputClass =
  'mb-4 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none transition-colors focus:border-accent';

export default async function LoginPage(props: PageProps<'/login'>) {
  const searchParams = await props.searchParams;
  const hasError = searchParams?.error === '1';

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

          {hasError && (
            <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300">
              E-mail ou senha inválidos.
            </p>
          )}

          <label className="mb-1 block text-sm font-medium text-ink" htmlFor="email">
            E-mail
          </label>
          <input id="email" name="email" type="email" required autoFocus className={inputClass} />

          <label className="mb-1 block text-sm font-medium text-ink" htmlFor="password">
            Senha
          </label>
          <input
            id="password"
            name="password"
            type="password"
            required
            className={`${inputClass} mb-6`}
          />

          <button
            type="submit"
            className="w-full rounded-lg bg-ink px-4 py-2 text-sm font-medium text-paper transition-opacity hover:opacity-90"
          >
            Entrar
          </button>
        </form>
      </div>
    </main>
  );
}
