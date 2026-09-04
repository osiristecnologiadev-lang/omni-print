import { LogoMark } from '@/components/Logo';
import { platformLoginAction } from './actions';

const inputClass = 'w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 outline-none transition-colors focus:border-amber-600';

export default async function PlatformLoginPage(props: PageProps<'/platform/login'>) {
  const searchParams = await props.searchParams;
  const hasError = searchParams?.error === '1';

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-950 px-6">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-center gap-2 text-gray-100">
          <LogoMark size={22} keyColor="#e8eaf0" />
          <span className="font-semibold">OmniPrint</span>
        </div>
        <form action={platformLoginAction} className="rounded-xl border border-gray-800 bg-gray-900 p-8 shadow-sm">
          <p className="mb-1 text-xs font-medium tracking-wide text-amber-500 uppercase">Área da plataforma</p>
          <h1 className="mb-1 text-lg font-semibold text-gray-100">Entrar</h1>
          <p className="mb-6 text-sm text-gray-400">Acesso restrito ao operador da OmniPrint.</p>

          {hasError && (
            <p className="mb-4 rounded-lg bg-red-950 px-3 py-2 text-sm text-red-300">E-mail ou senha inválidos.</p>
          )}

          <label className="mb-1 block text-sm font-medium text-gray-300" htmlFor="email">
            E-mail
          </label>
          <input id="email" name="email" type="email" required autoFocus className={`mb-4 ${inputClass}`} />

          <label className="mb-1 block text-sm font-medium text-gray-300" htmlFor="password">
            Senha
          </label>
          <input id="password" name="password" type="password" required className={`mb-6 ${inputClass}`} />

          <button
            type="submit"
            className="w-full rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-amber-500"
          >
            Entrar
          </button>
        </form>
      </div>
    </main>
  );
}
