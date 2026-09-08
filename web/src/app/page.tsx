import Link from 'next/link';
import { Logo, LogoMark } from '@/components/Logo';
import { ThemeToggle } from '@/components/ThemeToggle';
import { PlainSubmitButton } from '@/components/SubmitButton';
import { Banner } from '@/components/Banner';
import { signupAction } from './actions';

export const metadata = {
  title: 'OmniPrint — plataforma para outsourcing de impressão',
  description:
    'Monitore, preveja suprimentos e fature o parque de impressoras de todos os seus clientes num só painel. Cadastro em minutos, sem contrato de fidelidade.',
};

const inputClass =
  'mb-4 w-full rounded-lg border border-line bg-surface px-3 py-2.5 text-sm text-ink outline-none transition-colors focus:border-accent';

function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true" className="shrink-0 text-accent">
      <path d="M3 8.5l3 3 7-7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function MonitorIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3" y="4" width="18" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 20h8M12 16v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="17.5" cy="8.5" r="1.4" fill="currentColor" />
    </svg>
  );
}

function ForecastIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 18l4.5-6 4 3L19 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M14 6h5v5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function BillingIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="5" y="3" width="14" height="18" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8.5 8h7M8.5 12h7M8.5 16h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function PortfolioIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3" y="4" width="7" height="7" rx="1.2" stroke="currentColor" strokeWidth="1.5" />
      <rect x="14" y="4" width="7" height="7" rx="1.2" stroke="currentColor" strokeWidth="1.5" />
      <rect x="3" y="13" width="7" height="7" rx="1.2" stroke="currentColor" strokeWidth="1.5" />
      <rect x="14" y="13" width="7" height="7" rx="1.2" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function HelpdeskIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 12a8 8 0 1 1 3.2 6.4L4 20l1.2-3.6A7.96 7.96 0 0 1 4 12z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path d="M9 11.5h6M9 14h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function UpdateIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M20 12a8 8 0 1 1-2.34-5.66"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path d="M20 4v5h-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const FEATURES = [
  {
    icon: <MonitorIcon />,
    title: 'Monitoramento em tempo real',
    body: 'Status, contadores, bandejas e alertas de cada impressora de cada cliente, coletados sozinhos a cada 30 minutos — sem visita técnica pra saber o que está acontecendo.',
  },
  {
    icon: <ForecastIcon />,
    title: 'Previsão de suprimentos',
    body: 'Baseada no consumo real dos últimos 90 dias, não numa média genérica. Saiba quando um toner vai acabar antes do cliente ligar reclamando — e evite trocas antecipadas desnecessárias.',
  },
  {
    icon: <BillingIcon />,
    title: 'Faturamento automático',
    body: 'Contratos por franquia, por página ou fixos. A fatura sai calculada a partir dos contadores reais das impressoras, com PDF pronto pra enviar.',
  },
  {
    icon: <PortfolioIcon />,
    title: 'Portfólio multi-cliente',
    body: 'Cada cliente seu com seus próprios dispositivos, contratos e faturas — isolado dos outros, tudo visível num painel só, com login único.',
  },
  {
    icon: <HelpdeskIcon />,
    title: 'Help desk com SLA',
    body: 'Seus clientes abrem chamado, sua equipe atende com prazo de resposta por prioridade — sem precisar de outra ferramenta pra isso.',
  },
  {
    icon: <UpdateIcon />,
    title: 'Agente que se atualiza sozinho',
    body: 'Instala uma vez na rede do cliente e continua se atualizando sozinho depois — sem precisar reinstalar em cada visita.',
  },
];

const STEPS = [
  {
    n: '1',
    title: 'Instale o agente',
    body: 'Um instalador leve na rede do cliente descobre as impressoras sozinho — não precisa digitar IP por IP.',
  },
  {
    n: '2',
    title: 'A coleta é automática',
    body: 'A cada 30 minutos, o agente lê contadores, suprimentos e alertas de cada impressora e envia pra nuvem, com segurança.',
  },
  {
    n: '3',
    title: 'Você acompanha de qualquer lugar',
    body: 'Painel único com todos os clientes, prontos pra faturar e prever suprimento — sem depender de planilha.',
  },
];

const DIFFERENTIATORS = [
  'Cadastro em minutos, sem sales call obrigatório',
  'Previsão calculada do consumo real de cada equipamento, não de tabela genérica',
  'Faturamento direto dos contadores reais — sem digitar leitura na mão',
  'Sem fidelidade: sua conta, seus dados, cancele quando quiser',
];

export default async function LandingPage(props: PageProps<'/'>) {
  const searchParams = await props.searchParams;
  const signupError = searchParams?.signupError;

  return (
    <main className="bg-paper">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b border-line/60 bg-paper/85 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Logo size={22} />
          <nav className="hidden items-center gap-6 text-sm text-ink-muted sm:flex">
            <a href="#como-funciona" className="transition-colors hover:text-ink">
              Como funciona
            </a>
            <a href="#recursos" className="transition-colors hover:text-ink">
              Recursos
            </a>
          </nav>
          <div className="flex items-center gap-3">
            <ThemeToggle />
            <Link href="/login" className="text-sm font-medium text-ink-muted transition-colors hover:text-ink">
              Entrar
            </Link>
            <a
              href="#cadastro"
              className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-fg transition-opacity hover:opacity-90"
            >
              Criar conta grátis
            </a>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 -top-24 h-96 bg-[radial-gradient(ellipse_at_top,var(--color-accent-soft),transparent_70%)]"
        />
        <div className="relative mx-auto grid max-w-6xl grid-cols-1 items-center gap-12 px-6 pt-16 pb-20 lg:grid-cols-[1.1fr_1fr] lg:pt-24">
          <div>
            <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-xs font-medium text-ink-muted">
              <LogoMark size={14} />
              Feito para outsourcing de impressão
            </p>
            <h1 className="text-4xl leading-tight font-semibold text-ink sm:text-5xl">
              O parque de impressoras dos seus clientes, <span className="text-accent">sob controle total</span>
            </h1>
            <p className="mt-5 max-w-lg text-lg text-ink-muted">
              Monitoramento, previsão de suprimentos, faturamento automático e help desk — tudo num painel só, pra
              quem gerencia impressoras de vários clientes ao mesmo tempo.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-4">
              <a
                href="#cadastro"
                className="rounded-lg bg-accent px-6 py-3 text-sm font-semibold text-accent-fg shadow-sm shadow-accent/20 transition-opacity hover:opacity-90"
              >
                Criar conta grátis
              </a>
              <a href="#como-funciona" className="text-sm font-medium text-ink-muted transition-colors hover:text-ink">
                Ver como funciona ↓
              </a>
            </div>
            <p className="mt-4 text-xs text-ink-faint">Sem cartão de crédito. Cadastro leva menos de 2 minutos.</p>
          </div>

          {/* Product preview mockup - illustrative UI, not a real customer's data */}
          <div className="rounded-2xl border border-line bg-surface p-2 shadow-xl shadow-ink/[0.06]">
            <div className="flex items-center gap-1.5 border-b border-line px-3 py-2.5">
              <span className="h-2.5 w-2.5 rounded-full bg-red-400/70" />
              <span className="h-2.5 w-2.5 rounded-full bg-amber-400/70" />
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-400/70" />
              <span className="ml-2 text-xs text-ink-faint">app.omniprint.io/dashboard</span>
            </div>
            <div className="p-4">
              <div className="mb-3 grid grid-cols-4 gap-2">
                {[
                  { label: 'Total', value: '48' },
                  { label: 'Normais', value: '41' },
                  { label: 'Atenção', value: '5' },
                  { label: 'Críticos', value: '2' },
                ].map((s) => (
                  <div key={s.label} className="rounded-lg border border-line bg-paper px-2.5 py-2">
                    <p className="text-[10px] text-ink-faint">{s.label}</p>
                    <p className="text-lg font-semibold tabular-nums text-ink">{s.value}</p>
                  </div>
                ))}
              </div>
              <div className="overflow-hidden rounded-lg border border-line">
                <div className="grid grid-cols-[1fr_auto_auto] gap-2 bg-surface-2 px-3 py-1.5 text-[10px] font-medium text-ink-muted">
                  <span>Dispositivo</span>
                  <span>Status</span>
                  <span>Páginas</span>
                </div>
                {[
                  ['HP LaserJet — Recepção', 'ok', '128.4k'],
                  ['Samsung M4080 — Financeiro', 'warning', '84.1k'],
                  ['Kyocera 4053 — Almoxarifado', 'ok', '211.9k'],
                ].map(([name, status, pages]) => (
                  <div
                    key={name}
                    className="grid grid-cols-[1fr_auto_auto] items-center gap-2 border-t border-line px-3 py-2 text-xs"
                  >
                    <span className="truncate text-ink">{name}</span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                        status === 'ok'
                          ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                          : 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                      }`}
                    >
                      {status === 'ok' ? 'normal' : 'atenção'}
                    </span>
                    <span className="tabular-nums text-ink-muted">{pages}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Como funciona */}
      <section id="como-funciona" className="border-t border-line bg-surface/50">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <p className="mb-2 text-sm font-semibold text-accent">Como funciona</p>
          <h2 className="mb-12 max-w-xl text-2xl font-semibold text-ink sm:text-3xl">
            Do instalador ao painel, em três passos
          </h2>
          <div className="grid grid-cols-1 gap-8 sm:grid-cols-3">
            {STEPS.map((s) => (
              <div key={s.n}>
                <div className="mb-4 flex h-9 w-9 items-center justify-center rounded-full bg-accent text-sm font-semibold text-accent-fg">
                  {s.n}
                </div>
                <h3 className="mb-1.5 text-base font-semibold text-ink">{s.title}</h3>
                <p className="text-sm text-ink-muted">{s.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Recursos */}
      <section id="recursos" className="mx-auto max-w-6xl px-6 py-20">
        <p className="mb-2 text-sm font-semibold text-accent">Recursos</p>
        <h2 className="mb-12 max-w-xl text-2xl font-semibold text-ink sm:text-3xl">
          Tudo que uma operação de outsourcing precisa, num produto só
        </h2>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="rounded-xl border border-line bg-surface p-5 transition-shadow hover:shadow-md hover:shadow-ink/[0.04]">
              <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-accent-soft text-accent">
                {f.icon}
              </div>
              <h3 className="mb-1.5 text-sm font-semibold text-ink">{f.title}</h3>
              <p className="text-sm text-ink-muted">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Diferencial */}
      <section className="border-y border-line bg-surface/50">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <div className="grid grid-cols-1 gap-12 lg:grid-cols-2 lg:items-center">
            <div>
              <p className="mb-2 text-sm font-semibold text-accent">Por que OmniPrint</p>
              <h2 className="mb-4 text-2xl font-semibold text-ink sm:text-3xl">
                Construído pra quem vive de terceirizar impressão
              </h2>
              <p className="text-sm text-ink-muted">
                Não é uma planilha disfarçada de sistema, nem uma ferramenta genérica de TI adaptada às pressas.
                Cada tela foi pensada pro dia a dia de quem administra o parque de impressoras de vários clientes ao
                mesmo tempo.
              </p>
            </div>
            <ul className="space-y-4">
              {DIFFERENTIATORS.map((d) => (
                <li key={d} className="flex items-start gap-3 text-sm text-ink">
                  <CheckIcon />
                  {d}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* CTA band */}
      <section className="mx-auto max-w-6xl px-6 py-16 text-center">
        <h2 className="mb-3 text-2xl font-semibold text-ink sm:text-3xl">Pronto pra tirar a operação da planilha?</h2>
        <p className="mx-auto mb-6 max-w-md text-sm text-ink-muted">
          Crie sua conta agora e comece a cadastrar clientes e monitorar impressoras hoje mesmo.
        </p>
        <a
          href="#cadastro"
          className="inline-flex items-center justify-center rounded-lg bg-accent px-6 py-3 text-sm font-semibold text-accent-fg shadow-sm shadow-accent/20 transition-opacity hover:opacity-90"
        >
          Criar conta grátis
        </a>
      </section>

      {/* Signup form */}
      <section id="cadastro" className="mx-auto max-w-sm px-6 pb-24">
        <form action={signupAction} className="rounded-xl border border-line bg-surface p-8 shadow-sm shadow-ink/[0.03]">
          <h2 className="mb-1 text-lg font-semibold text-ink">Criar conta</h2>
          <p className="mb-6 text-sm text-ink-muted">
            Cadastre sua empresa de outsourcing e comece a monitorar seus clientes agora.
          </p>

          {signupError === 'email-taken' && (
            <Banner tone="error">Esse e-mail já está cadastrado. Tente entrar em vez de criar uma conta nova.</Banner>
          )}
          {signupError === 'unknown' && <Banner tone="error">Não foi possível criar a conta. Tente novamente.</Banner>}

          <label className="mb-1 block text-sm font-medium text-ink" htmlFor="companyName">
            Nome da empresa
          </label>
          <input id="companyName" name="companyName" type="text" required className={inputClass} />

          <label className="mb-1 block text-sm font-medium text-ink" htmlFor="email">
            E-mail
          </label>
          <input id="email" name="email" type="email" required className={inputClass} />

          <label className="mb-1 block text-sm font-medium text-ink" htmlFor="password">
            Senha
          </label>
          <input id="password" name="password" type="password" required minLength={8} className={`${inputClass} mb-6`} />

          <PlainSubmitButton
            className="w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-accent-fg transition-opacity hover:opacity-90"
            pendingLabel="Criando conta..."
          >
            Criar conta
          </PlainSubmitButton>

          <p className="mt-4 text-center text-xs text-ink-faint">
            Já tem conta?{' '}
            <Link href="/login" className="text-accent hover:underline">
              Entrar
            </Link>
          </p>
        </form>
      </section>

      {/* Footer */}
      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 py-8 text-xs text-ink-faint sm:flex-row">
          <Logo size={16} />
          <p>© {new Date().getFullYear()} OmniPrint. Todos os direitos reservados.</p>
        </div>
      </footer>
    </main>
  );
}
