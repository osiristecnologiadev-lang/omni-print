import Link from 'next/link';
import { forbidden, notFound } from 'next/navigation';
import {
  getCustomer,
  getCustomerTokens,
  getCurrentPeriodBilling,
  getDevices,
  getLowSupplyForecast,
  getSession,
  getUsers,
} from '@/lib/api';
import { CreateTokenForm } from './CreateTokenForm';
import {
  createCustomerUserAction,
  revokeCustomerUserAction,
  revokeTokenAction,
  updateCustomerInfoAction,
  updateCustomerSlaAction,
} from './actions';
import { PageHeader } from '@/components/PageHeader';
import { Panel, PanelSection } from '@/components/Panel';
import { Button, buttonClasses } from '@/components/Button';
import { Badge } from '@/components/Badge';
import { SupplyForecastFacts } from '@/components/SupplyForecastFacts';

const fieldClass =
  'w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none transition-colors focus:border-accent';
const inputClass = `mt-1 ${fieldClass}`;

function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso));
}

// periodStart is a UTC-midnight-anchored calendar date (always the 1st of
// a month), not a specific instant - formatting in the server's local
// timezone shifts it back a day for any negative-offset locale (confirmed:
// this app's dev server, America/Cuiaba UTC-4, showed "31/08" for a
// September 1st UTC timestamp). Read the UTC calendar fields directly.
function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeZone: 'UTC' }).format(new Date(iso));
}

const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

export default async function CustomerPage(props: PageProps<'/customers/[id]'>) {
  const { id } = await props.params;
  const searchParams = await props.searchParams;

  const session = await getSession();
  if (session?.customerId) {
    forbidden();
  }

  const customer = await getCustomer(id).catch(() => undefined);
  if (!customer) {
    notFound();
  }

  const [devices, tokens, users, lowSupplies, currentPeriod] = await Promise.all([
    getDevices(),
    getCustomerTokens(id),
    getUsers(),
    getLowSupplyForecast(14, 90),
    getCurrentPeriodBilling(id),
  ]);
  const customerDevices = devices.filter((d) => d.customerId === id);
  const customerUsers = users.filter((u) => u.customerId === id);
  const customerLowSupplies = lowSupplies.filter((s) => s.customerId === id);
  const boundRevokeToken = revokeTokenAction.bind(null, id);
  const boundCreateUser = createCustomerUserAction.bind(null, id);
  const boundRevokeUser = revokeCustomerUserAction.bind(null, id);
  const boundUpdateInfo = updateCustomerInfoAction.bind(null, id);
  const boundUpdateSla = updateCustomerSlaAction.bind(null, id);

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <PageHeader
        title={customer.name}
        subtitle={`${customerDevices.length} dispositivo${customerDevices.length === 1 ? '' : 's'}`}
        back={{ href: '/customers', label: 'Clientes' }}
        actions={
          <>
            <Link href={`/customers/${id}/contract`} className={buttonClasses('secondary', 'sm')}>
              Contrato
            </Link>
            <Link href={`/customers/${id}/invoices`} className={buttonClasses('secondary', 'sm')}>
              Faturas
            </Link>
          </>
        }
      />

      {currentPeriod.hasContract && (
        <Panel className="mb-6">
          <div className="mb-1 flex items-baseline justify-between gap-3">
            <h2 className="text-sm font-medium text-ink">Faturamento do período atual</h2>
            <Link href={`/customers/${id}/contract`} className="text-xs text-accent hover:underline">
              Ver contrato
            </Link>
          </div>
          <p className="mb-3 text-xs text-ink-faint">
            Já garantido desde {formatDate(currentPeriod.periodStart)} - o período ainda está em andamento, este valor só
            cresce até a fatura ser gerada.
          </p>
          <div className="flex items-baseline gap-6">
            <div>
              <p className="text-2xl font-semibold tabular-nums text-ink">{currency.format(currentPeriod.totalDue)}</p>
              <p className="text-xs text-ink-faint">valor garantido</p>
            </div>
            <div>
              <p className="text-2xl font-semibold tabular-nums text-ink">{currentPeriod.totalPages}</p>
              <p className="text-xs text-ink-faint">páginas até agora</p>
            </div>
          </div>
        </Panel>
      )}

      {customerLowSupplies.length > 0 && (
        <Panel className="mb-6">
          <h2 className="mb-1 text-sm font-medium text-ink">Suprimentos que precisam de atenção</h2>
          <p className="mb-3 text-xs text-ink-faint">Previsão a partir do consumo real dos últimos 90 dias.</p>
          <ul className="divide-y divide-line">
            {customerLowSupplies.map((s, i) => (
              <li key={`${s.deviceId}-${i}`} className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1 py-2.5 text-sm">
                <div className="flex min-w-0 items-center gap-2">
                  {s.premature ? (
                    <Badge tone="info">Troca antecipada</Badge>
                  ) : s.likelyEmptyAlready ? (
                    <Badge tone="critical">Provavelmente vazio</Badge>
                  ) : (
                    <Badge tone="warning">{s.daysRemaining}d restantes</Badge>
                  )}
                  <Link href={`/devices/${s.deviceId}`} className="truncate font-medium text-ink transition-colors hover:text-accent">
                    {s.deviceName}
                  </Link>
                  <span className="truncate text-xs text-ink-faint">{s.description}</span>
                </div>
                <SupplyForecastFacts forecast={s} />
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <Panel className="mb-6">
        <h2 className="mb-1 text-sm font-medium text-ink">Dados fiscais</h2>
        <p className="mb-4 text-xs text-ink-faint">
          Aparecem no bloco &ldquo;cliente&rdquo; das faturas geradas para &ldquo;{customer.name}&rdquo;.
        </p>
        <form action={boundUpdateInfo} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="text-xs text-ink-muted">
            CNPJ/CPF
            <input name="document" defaultValue={customer.document ?? ''} placeholder="00.000.000/0001-00" className={inputClass} />
          </label>
          <label className="text-xs text-ink-muted">
            Endereço
            <input
              name="address"
              defaultValue={customer.address ?? ''}
              placeholder="Rua Exemplo, 100 - Cidade/UF"
              className={inputClass}
            />
          </label>
          <Button type="submit" variant="secondary" size="sm" className="sm:col-span-2 sm:w-fit">
            Salvar
          </Button>
        </form>
      </Panel>

      <Panel className="mb-6">
        <h2 className="mb-1 text-sm font-medium text-ink">SLA de chamados</h2>
        <p className="mb-4 text-xs text-ink-faint">
          Prazo de resposta por prioridade para os chamados de &ldquo;{customer.name}&rdquo;. Deixe em branco para usar
          o padrão do sistema (Urgente 4h, Alta 24h, Média 48h, Baixa 72h).
        </p>
        <form action={boundUpdateSla} className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <label className="text-xs text-ink-muted">
            Urgente (h)
            <input
              name="slaHoursUrgent"
              type="number"
              min={0}
              max={999}
              defaultValue={customer.slaHoursUrgent ?? ''}
              placeholder="4"
              className={inputClass}
            />
          </label>
          <label className="text-xs text-ink-muted">
            Alta (h)
            <input
              name="slaHoursHigh"
              type="number"
              min={0}
              max={999}
              defaultValue={customer.slaHoursHigh ?? ''}
              placeholder="24"
              className={inputClass}
            />
          </label>
          <label className="text-xs text-ink-muted">
            Média (h)
            <input
              name="slaHoursMedium"
              type="number"
              min={0}
              max={999}
              defaultValue={customer.slaHoursMedium ?? ''}
              placeholder="48"
              className={inputClass}
            />
          </label>
          <label className="text-xs text-ink-muted">
            Baixa (h)
            <input
              name="slaHoursLow"
              type="number"
              min={0}
              max={999}
              defaultValue={customer.slaHoursLow ?? ''}
              placeholder="72"
              className={inputClass}
            />
          </label>
          <Button type="submit" variant="secondary" size="sm" className="col-span-2 w-fit sm:col-span-4">
            Salvar
          </Button>
        </form>
      </Panel>

      <Panel>
        <h2 className="mb-1 text-sm font-medium text-ink">Acesso do cliente</h2>
        <p className="mb-4 text-xs text-ink-faint">
          Crie um login para alguém em &ldquo;{customer.name}&rdquo; acompanhar as próprias impressoras. Acesso é
          somente leitura — não gerencia clientes, usuários ou tokens.
        </p>

        {searchParams?.userCreated === '1' && (
          <p className="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
            Acesso criado.
          </p>
        )}
        {searchParams?.userError === 'email_in_use' && (
          <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300">
            Já existe um usuário com esse e-mail.
          </p>
        )}
        {searchParams?.userError === '1' && (
          <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300">
            Não foi possível criar o acesso. Confira os dados e tente novamente.
          </p>
        )}

        <form action={boundCreateUser} className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <input name="name" placeholder="Nome" className={fieldClass} />
          <input name="email" type="email" placeholder="E-mail" required className={fieldClass} />
          <input name="password" type="password" placeholder="Senha (mín. 8)" required minLength={8} className={fieldClass} />
          <Button type="submit" variant="primary" className="sm:col-span-3">
            Criar acesso
          </Button>
        </form>

        {customerUsers.length > 0 && (
          <ul className="mt-4 divide-y divide-line border-t border-line">
            {customerUsers.map((u) => (
              <li key={u.id} className="flex items-center justify-between py-2.5 text-sm">
                <div>
                  <span className="text-ink">{u.name || u.email}</span>
                  <span className="ml-2 text-xs text-ink-faint">{u.email}</span>
                </div>
                {u.revokedAt ? (
                  <span className="text-xs text-ink-faint">revogado</span>
                ) : (
                  <form action={boundRevokeUser.bind(null, u.id)}>
                    <Button type="submit" variant="danger">
                      Revogar
                    </Button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel className="mt-6">
        <h2 className="mb-1 text-sm font-medium text-ink">Tokens de agente</h2>
        <p className="mb-4 text-xs text-ink-faint">
          Gere um código para cada instalação do agente no site deste cliente. Toda impressora que aquele agente
          encontrar já chega marcada como &ldquo;{customer.name}&rdquo; automaticamente.
        </p>

        <CreateTokenForm customerId={id} />

        {tokens.length > 0 && (
          <ul className="mt-4 divide-y divide-line border-t border-line">
            {tokens.map((t) => (
              <li key={t.id} className="flex items-center justify-between py-2.5 text-sm">
                <div>
                  <span className="text-ink">{t.label || 'Sem rótulo'}</span>
                  <span className="ml-2 text-xs text-ink-faint">criado em {formatDateTime(t.createdAt)}</span>
                </div>
                {t.revokedAt ? (
                  <span className="text-xs text-ink-faint">revogado</span>
                ) : (
                  <form action={boundRevokeToken.bind(null, t.id)}>
                    <Button type="submit" variant="danger">
                      Revogar
                    </Button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <PanelSection title="Dispositivos" className="mt-6">
        {customerDevices.length === 0 ? (
          <p className="p-5 text-sm text-ink-faint">Nenhum dispositivo atribuído ainda.</p>
        ) : (
          <ul className="divide-y divide-line">
            {customerDevices.map((d) => (
              <li key={d.id} className="px-5 py-3 text-sm">
                <Link href={`/devices/${d.id}`} className="text-ink transition-colors hover:text-accent">
                  {d.customLabel ?? d.printerName ?? d.name ?? d.host}
                </Link>
                <span className="ml-2 text-xs text-ink-faint">{d.host}</span>
              </li>
            ))}
          </ul>
        )}
      </PanelSection>
    </main>
  );
}
