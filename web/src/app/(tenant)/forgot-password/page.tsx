import Link from 'next/link';
import { Logo } from '@/components/Logo';
import { ThemeToggle } from '@/components/ThemeToggle';
import { SubmitButton } from '@/components/SubmitButton';
import { Banner } from '@/components/Banner';
import { requestPasswordResetAction } from './actions';

const inputClass =
  'mb-4 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none transition-colors focus:border-accent';

export default async function ForgotPasswordPage(props: PageProps<'/forgot-password'>) {
  const searchParams = await props.searchParams;
  const sent = searchParams?.sent === '1';

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
          <h1 className="mb-1 text-lg font-semibold text-ink">Esqueci minha senha</h1>
          <p className="mb-6 text-sm text-ink-muted">Informe o e-mail da sua conta e enviaremos um link para redefinir a senha.</p>

          {sent ? (
            <Banner tone="success">
              Se o e-mail existir, você receberá em instantes um link para redefinir a senha. Confira também a caixa de spam.
            </Banner>
          ) : (
            <form action={requestPasswordResetAction}>
              <label className="mb-1 block text-sm font-medium text-ink" htmlFor="email">
                E-mail
              </label>
              <input id="email" name="email" type="email" required autoFocus className={inputClass} />

              <SubmitButton variant="primary" className="w-full" pendingLabel="Enviando...">
                Enviar link de redefinição
              </SubmitButton>
            </form>
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
