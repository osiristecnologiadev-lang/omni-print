import Link from 'next/link';
import { Logo } from '@/components/Logo';
import { ThemeToggle } from '@/components/ThemeToggle';
import { SubmitButton } from '@/components/SubmitButton';
import { Banner } from '@/components/Banner';
import { resetPasswordAction } from './actions';

const inputClass =
  'mb-4 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none transition-colors focus:border-accent';

export default async function ResetPasswordPage(props: PageProps<'/reset-password'>) {
  const searchParams = await props.searchParams;
  const token = typeof searchParams?.token === 'string' ? searchParams.token : '';
  const error = typeof searchParams?.error === 'string' ? searchParams.error : undefined;

  return (
    <main className="relative flex min-h-screen items-center justify-center bg-paper px-6">
      <div className="absolute top-6 right-6">
        <ThemeToggle />
      </div>
      <div className="w-full max-w-sm">
        <div className="mb-6 flex justify-center">
          <Logo size={22} />
        </div>
        <div className="rounded-xl border border-line bg-surface p-8 shadow-sm shadow-ink/[0.03]">
          <h1 className="mb-1 text-lg font-semibold text-ink">Redefinir senha</h1>
          <p className="mb-6 text-sm text-ink-muted">Escolha uma nova senha para a sua conta.</p>

          {!token ? (
            <Banner tone="error">
              Link inválido. Solicite um novo link em{' '}
              <Link href="/forgot-password" className="underline">
                esqueci minha senha
              </Link>
              .
            </Banner>
          ) : (
            <>
              {error === 'mismatch' && <Banner tone="error">As senhas não coincidem.</Banner>}
              {error === 'invalid' && (
                <Banner tone="error">
                  Este link é inválido ou expirou. Solicite um novo em{' '}
                  <Link href="/forgot-password" className="underline">
                    esqueci minha senha
                  </Link>
                  .
                </Banner>
              )}

              <form action={resetPasswordAction}>
                <input type="hidden" name="token" value={token} />

                <label className="mb-1 block text-sm font-medium text-ink" htmlFor="password">
                  Nova senha
                </label>
                <input
                  id="password"
                  name="password"
                  type="password"
                  required
                  minLength={8}
                  autoFocus
                  className={inputClass}
                />

                <label className="mb-1 block text-sm font-medium text-ink" htmlFor="confirmPassword">
                  Confirmar nova senha
                </label>
                <input
                  id="confirmPassword"
                  name="confirmPassword"
                  type="password"
                  required
                  minLength={8}
                  className={`${inputClass} mb-6`}
                />

                <SubmitButton variant="primary" className="w-full" pendingLabel="Salvando...">
                  Redefinir senha
                </SubmitButton>
              </form>
            </>
          )}

          <p className="mt-6 text-center text-sm text-ink-muted">
            <Link href="/login" className="text-accent hover:underline">
              Voltar para o login
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}
