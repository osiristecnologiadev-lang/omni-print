import Link from 'next/link';
import { Logo } from '@/components/Logo';
import { ThemeToggle } from '@/components/ThemeToggle';
import { Panel } from '@/components/Panel';
import { signupAction } from './actions';

export const metadata = {
  title: 'OmniPrint — monitoramento de parque de impressoras',
  description:
    'Plataforma para empresas de outsourcing de impressão: monitore o parque de impressoras dos seus clientes, preveja suprimentos e automatize o faturamento em um só lugar.',
};

const inputClass =
  'mb-4 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none transition-colors focus:border-accent';

const FEATURES = [
  {
    title: 'Monitoramento em tempo real',
    body: 'Status, contadores e alertas de cada impressora de cada cliente, num painel só — sem precisar visitar site por site.',
  },
  {
    title: 'Previsão de suprimentos',
    body: 'Baseado no consumo real dos últimos 90 dias: saiba quando um toner vai acabar antes que o cliente ligue reclamando.',
  },
  {
    title: 'Faturamento automatizado',
    body: 'Contratos por franquia, por página ou fixos — a fatura é calculada a partir dos contadores reais, com PDF pronto.',
  },
  {
    title: 'Portfólio multi-cliente',
    body: 'Cada cliente seu, com seus próprios dispositivos, contratos e faturas — tudo isolado, tudo num só login.',
  },
];

export default async function LandingPage(props: PageProps<'/'>) {
  const searchParams = await props.searchParams;
  const signupError = searchParams?.signupError;

  return (
    <main className="bg-paper">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-6 py-6">
        <Logo size={22} />
        <div className="flex items-center gap-4">
          <ThemeToggle />
          <Link href="/login" className="text-sm font-medium text-ink-muted transition-colors hover:text-accent">
            Entrar
          </Link>
        </div>
      </header>

      <section className="mx-auto max-w-3xl px-6 pt-10 pb-16 text-center">
        <h1 className="text-3xl font-semibold text-ink sm:text-4xl">
          O parque de impressoras dos seus clientes, sob controle
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-base text-ink-muted">
          OmniPrint é a plataforma para empresas de outsourcing de impressão monitorarem, preverem suprimentos e
          faturarem o parque de impressoras de todos os seus clientes — num só lugar.
        </p>
        <a
          href="#cadastro"
          className="mt-8 inline-flex items-center justify-center rounded-lg bg-ink px-6 py-2.5 text-sm font-medium text-paper transition-opacity hover:opacity-90"
        >
          Criar conta grátis
        </a>
      </section>

      <section className="mx-auto max-w-5xl px-6 pb-16">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {FEATURES.map((f) => (
            <Panel key={f.title}>
              <h2 className="mb-1.5 text-sm font-semibold text-ink">{f.title}</h2>
              <p className="text-sm text-ink-muted">{f.body}</p>
            </Panel>
          ))}
        </div>
      </section>

      <section id="cadastro" className="mx-auto max-w-sm px-6 pb-20">
        <form action={signupAction} className="rounded-xl border border-line bg-surface p-8 shadow-sm shadow-ink/[0.03]">
          <h2 className="mb-1 text-lg font-semibold text-ink">Criar conta</h2>
          <p className="mb-6 text-sm text-ink-muted">
            Cadastre sua empresa de outsourcing e comece a monitorar seus clientes agora.
          </p>

          {signupError === 'email-taken' && (
            <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300">
              Esse e-mail já está cadastrado. Tente entrar em vez de criar uma conta nova.
            </p>
          )}
          {signupError === 'unknown' && (
            <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300">
              Não foi possível criar a conta. Tente novamente.
            </p>
          )}

          <label className="mb-1 block text-sm font-medium text-ink" htmlFor="companyName">
            Nome da empresa
          </label>
          <input id="companyName" name="companyName" type="text" required autoFocus className={inputClass} />

          <label className="mb-1 block text-sm font-medium text-ink" htmlFor="email">
            E-mail
          </label>
          <input id="email" name="email" type="email" required className={inputClass} />

          <label className="mb-1 block text-sm font-medium text-ink" htmlFor="password">
            Senha
          </label>
          <input
            id="password"
            name="password"
            type="password"
            required
            minLength={8}
            className={`${inputClass} mb-6`}
          />

          <button
            type="submit"
            className="w-full rounded-lg bg-ink px-4 py-2 text-sm font-medium text-paper transition-opacity hover:opacity-90"
          >
            Criar conta
          </button>

          <p className="mt-4 text-center text-xs text-ink-faint">
            Já tem conta?{' '}
            <Link href="/login" className="text-accent hover:underline">
              Entrar
            </Link>
          </p>
        </form>
      </section>
    </main>
  );
}
