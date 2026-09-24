import Link from 'next/link';
import { forbidden, notFound } from 'next/navigation';
import {
  getCustomer,
  getCustomerTokens,
  getCustomerEnrollmentCodes,
  getCurrentPeriodBilling,
  getDevices,
  getLowSupplyForecast,
  getViewerAccess,
  getUsers,
  getViewerTimeZone,
  type AgentTokenSummary,
  type AgentEnrollmentCodeSummary,
  type AgentCommandType,
} from '@/lib/api';
import { hasPermission } from '@/lib/permissions';
import { CreateEnrollmentCodeForm } from './CreateEnrollmentCodeForm';
import {
  createCustomerUserAction,
  revokeCustomerUserAction,
  revokeTokenAction,
  requestLogAction,
  requestCommandAction,
  revokeEnrollmentCodeAction,
  updateCustomerInfoAction,
  updateCustomerNotifyEmailAction,
  updateCustomerSlaAction,
} from './actions';
import { PageHeader } from '@/components/PageHeader';
import { Panel } from '@/components/Panel';
import { buttonClasses } from '@/components/Button';
import { SubmitButton } from '@/components/SubmitButton';
import { Banner } from '@/components/Banner';
import { Badge } from '@/components/Badge';
import { SupplyForecastFacts } from '@/components/SupplyForecastFacts';
import { DeviceFleetTable } from '@/components/DeviceFleetTable';
import { deriveHealth } from '@/lib/health';

const fieldClass =
  'w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none transition-colors focus:border-accent';
const inputClass = `mt-1 ${fieldClass}`;

// Server Components render on Railway (UTC) - see getViewerTimeZone.
function formatDateTime(iso: string, timeZone?: string): string {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone }).format(new Date(iso));
}

// A token is only meaningfully "active" if an agent has actually checked in
// with it recently - auto_update's default check_interval is 6h, so a real
// live install should never go much past that without being seen again.
const TOKEN_STALE_AFTER_MS = 24 * 60 * 60 * 1000;

function tokenStatusBadge(t: AgentTokenSummary) {
  if (t.revokedAt) return <Badge tone="neutral">Revogado</Badge>;
  if (!t.lastCheckinAt) return <Badge tone="warning">Nunca conectou</Badge>;
  const stale = Date.now() - new Date(t.lastCheckinAt).getTime() > TOKEN_STALE_AFTER_MS;
  return stale ? <Badge tone="warning">Inativo</Badge> : <Badge tone="ok">Ativo</Badge>;
}

// "Pending" mirrors AgentLogService.hasPendingRequest on the API side
// exactly (logRequestedAt set and not yet satisfied by a newer
// logUploadedAt) - the agent only notices a request on its own next poll
// (up to 2 minutes later, see agent/internal/svc), there's no way to make
// it happen faster than that.
function logRequestPending(t: AgentTokenSummary): boolean {
  if (!t.logRequestedAt) return false;
  return !t.logUploadedAt || new Date(t.logUploadedAt) < new Date(t.logRequestedAt);
}

// Remote commands (restart / update now / discover now) - first shipped in
// agent v0.1.13; an older agent never polls for them, so the buttons would
// only ever produce "não recebido". Hidden until the token has checked in
// on a version that understands them.
const REMOTE_COMMANDS_MIN_VERSION = [0, 1, 13];

function supportsRemoteCommands(version: string | null): boolean {
  if (!version) return false;
  const parts = version.split('.').map(Number);
  for (let i = 0; i < REMOTE_COMMANDS_MIN_VERSION.length; i++) {
    const have = parts[i] ?? 0;
    if (have !== REMOTE_COMMANDS_MIN_VERSION[i]) return have > REMOTE_COMMANDS_MIN_VERSION[i];
  }
  return true;
}

const COMMAND_LABEL: Record<AgentCommandType, string> = {
  RESTART: 'Reiniciar agente',
  UPDATE: 'Verificar atualização agora',
  DISCOVER: 'Buscar impressoras agora',
};

// Must match COMMAND_EXPIRY_MS in api/src/agent-command - past this, the API
// stops handing the request to the agent at all.
const COMMAND_EXPIRY_MS = 30 * 60 * 1000;

function commandStatus(t: AgentTokenSummary, tz?: string): string | null {
  if (!t.commandType || !t.commandRequestedAt) return null;
  const label = COMMAND_LABEL[t.commandType];
  if (t.commandAckedAt) {
    return `${label} (${formatDateTime(t.commandAckedAt, tz)}): ${t.commandResult ?? 'recebido'}`;
  }
  if (Date.now() - new Date(t.commandRequestedAt).getTime() > COMMAND_EXPIRY_MS) {
    return `${label}: não recebido - o agente não ficou online em até 30 minutos. Envie de novo quando ele voltar.`;
  }
  return `${label}: aguardando o agente (até 2 minutos, se estiver online)...`;
}

function isEnrollmentCodeExpired(c: AgentEnrollmentCodeSummary): boolean {
  return new Date(c.expiresAt).getTime() < Date.now();
}

function isEnrollmentCodePending(c: AgentEnrollmentCodeSummary): boolean {
  return !c.usedAt && !c.revokedAt && !isEnrollmentCodeExpired(c);
}

// Precedence matters: a code used before its expiry should read "Usado",
// not "Expirado" (both can be true at once once enough time has passed).
function enrollmentCodeStatusBadge(c: AgentEnrollmentCodeSummary) {
  if (c.usedAt) return <Badge tone="ok">Usado</Badge>;
  if (c.revokedAt) return <Badge tone="neutral">Revogado</Badge>;
  if (isEnrollmentCodeExpired(c)) return <Badge tone="neutral">Expirado</Badge>;
  return <Badge tone="info">Pendente</Badge>;
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

  const access = await getViewerAccess();
  if (!hasPermission(access, 'customers')) {
    forbidden();
  }
  const canSeeAgent = hasPermission(access, 'agent');
  const canSeeUsers = hasPermission(access, 'users');

  const customer = await getCustomer(id).catch(() => undefined);
  if (!customer) {
    notFound();
  }

  const [devices, tokens, enrollmentCodes, users, lowSupplies, currentPeriod, tz] = await Promise.all([
    getDevices(),
    canSeeAgent ? getCustomerTokens(id) : Promise.resolve([]),
    canSeeAgent ? getCustomerEnrollmentCodes(id) : Promise.resolve([]),
    canSeeUsers ? getUsers() : Promise.resolve([]),
    getLowSupplyForecast(14, 90),
    getCurrentPeriodBilling(id),
    getViewerTimeZone(),
  ]);
  const customerDevices = devices.filter((d) => d.customerId === id);
  const customerUsers = users.filter((u) => u.customerId === id);
  const customerLowSupplies = lowSupplies.filter((s) => s.customerId === id);
  const boundRevokeToken = revokeTokenAction.bind(null, id);
  const boundRequestLog = requestLogAction.bind(null, id);
  const boundRequestCommand = requestCommandAction.bind(null, id);
  const boundRevokeEnrollmentCode = revokeEnrollmentCodeAction.bind(null, id);
  const boundCreateUser = createCustomerUserAction.bind(null, id);
  const boundRevokeUser = revokeCustomerUserAction.bind(null, id);
  const boundUpdateInfo = updateCustomerInfoAction.bind(null, id);
  const boundUpdateNotifyEmail = updateCustomerNotifyEmailAction.bind(null, id);
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
        {searchParams?.infoSaved === '1' && <Banner tone="success">Dados fiscais salvos.</Banner>}
        {searchParams?.infoError === '1' && (
          <Banner tone="error">Não foi possível salvar os dados fiscais. Tente novamente.</Banner>
        )}
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
          <SubmitButton variant="secondary" size="sm" className="sm:col-span-2 sm:w-fit" pendingLabel="Salvando...">
            Salvar
          </SubmitButton>
        </form>
      </Panel>

      <Panel className="mb-6">
        <h2 className="mb-1 text-sm font-medium text-ink">Notificações por e-mail para &ldquo;{customer.name}&rdquo;</h2>
        <p className="mb-4 text-xs text-ink-faint">
          Se preenchido, esse contato recebe um e-mail quando um dispositivo dele tiver um alerta crítico ou
          suprimento baixo - nunca sobre faturas ou contratos. Depende também do interruptor geral de e-mail estar
          ativo em Notificações. Deixe em branco para não notificar ninguém do lado do cliente.
        </p>
        {searchParams?.notifyEmailSaved === '1' && <Banner tone="success">E-mail de notificação salvo.</Banner>}
        {searchParams?.notifyEmailError === '1' && (
          <Banner tone="error">Não foi possível salvar o e-mail de notificação. Tente novamente.</Banner>
        )}
        <form action={boundUpdateNotifyEmail} className="flex flex-wrap items-end gap-2">
          <label className="flex-1 text-xs text-ink-muted">
            E-mail do cliente
            <input
              type="email"
              name="notifyEmail"
              defaultValue={customer.notifyEmail ?? ''}
              placeholder="contato@clientedaoutsource.com"
              className={`${inputClass} w-full`}
            />
          </label>
          <SubmitButton variant="secondary" size="sm" pendingLabel="Salvando...">
            Salvar
          </SubmitButton>
        </form>
      </Panel>

      <Panel className="mb-6">
        <h2 className="mb-1 text-sm font-medium text-ink">SLA de chamados</h2>
        <p className="mb-4 text-xs text-ink-faint">
          Prazo de resposta por prioridade para os chamados de &ldquo;{customer.name}&rdquo;. Deixe em branco para usar
          o padrão do sistema (Urgente 4h, Alta 24h, Média 48h, Baixa 72h).
        </p>
        {searchParams?.slaSaved === '1' && <Banner tone="success">SLA salvo.</Banner>}
        {searchParams?.slaError === '1' && <Banner tone="error">Não foi possível salvar o SLA. Tente novamente.</Banner>}
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
          <SubmitButton variant="secondary" size="sm" className="col-span-2 w-fit sm:col-span-4" pendingLabel="Salvando...">
            Salvar
          </SubmitButton>
        </form>
      </Panel>

      {canSeeUsers && (
      <Panel>
        <h2 className="mb-1 text-sm font-medium text-ink">Acesso do cliente</h2>
        <p className="mb-4 text-xs text-ink-faint">
          Crie um login para alguém em &ldquo;{customer.name}&rdquo; acompanhar as próprias impressoras. Acesso é
          somente leitura — não gerencia clientes, usuários ou tokens.
        </p>

        {searchParams?.userCreated === '1' && <Banner tone="success">Acesso criado.</Banner>}
        {searchParams?.userError === 'email_in_use' && <Banner tone="error">Já existe um usuário com esse e-mail.</Banner>}
        {searchParams?.userError === '1' && (
          <Banner tone="error">Não foi possível criar o acesso. Confira os dados e tente novamente.</Banner>
        )}
        {searchParams?.userRevoked === '1' && <Banner tone="success">Acesso revogado.</Banner>}
        {searchParams?.userRevokeError === '1' && <Banner tone="error">Não foi possível revogar o acesso. Tente novamente.</Banner>}

        <form action={boundCreateUser} className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <input name="name" placeholder="Nome" className={fieldClass} />
          <input name="email" type="email" placeholder="E-mail" required className={fieldClass} />
          <input name="password" type="password" placeholder="Senha (mín. 8)" required minLength={8} className={fieldClass} />
          <label className="flex items-center gap-2 text-sm text-ink sm:col-span-3">
            <input type="checkbox" name="permissions" value="invoices_view" className="h-4 w-4" />
            Permitir ver faturas e boletos
          </label>
          <SubmitButton variant="primary" className="sm:col-span-3" pendingLabel="Criando...">
            Criar acesso
          </SubmitButton>
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
                    <SubmitButton variant="danger" pendingLabel="Revogando...">
                      Revogar
                    </SubmitButton>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>
      )}

      {canSeeAgent && (
      <>
      <Panel className="mt-6">
        <h2 className="mb-1 text-sm font-medium text-ink">Códigos de instalação do agente</h2>
        <p className="mb-4 text-xs text-ink-faint">
          Gere um código curto para cada instalação do agente no site deste cliente e envie para quem for
          instalar — o assistente do instalador pede só esse código e troca ele pelos dados reais sozinho.
          Vale por 24 horas e só funciona uma vez.
        </p>

        {searchParams?.enrollmentCodeRevoked === '1' && <Banner tone="success">Código revogado.</Banner>}
        {searchParams?.enrollmentCodeError === '1' && (
          <Banner tone="error">Não foi possível revogar o código. Tente novamente.</Banner>
        )}

        <CreateEnrollmentCodeForm customerId={id} />

        {enrollmentCodes.length > 0 && (
          <ul className="mt-4 divide-y divide-line border-t border-line">
            {enrollmentCodes.map((c) => {
              const pending = isEnrollmentCodePending(c);
              return (
                <li key={c.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-ink">{c.label || 'Sem rótulo'}</span>
                      {enrollmentCodeStatusBadge(c)}
                    </div>
                    <div className="text-xs text-ink-faint">
                      criado em {formatDateTime(c.createdAt, tz)} · expira em {formatDateTime(c.expiresAt, tz)}
                    </div>
                  </div>
                  {pending && (
                    <form action={boundRevokeEnrollmentCode.bind(null, c.id)}>
                      <SubmitButton variant="danger" pendingLabel="Revogando...">
                        Revogar
                      </SubmitButton>
                    </form>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      <Panel className="mt-6">
        <h2 className="mb-1 text-sm font-medium text-ink">Agentes instalados</h2>
        <p className="mb-4 text-xs text-ink-faint">
          Cada instalação feita com um código de instalação aparece aqui. Toda impressora que o agente encontrar
          já chega marcada como &ldquo;{customer.name}&rdquo; automaticamente. Revogar desliga aquele agente
          de vez — para reinstalar, gere um novo código.
        </p>

        {searchParams?.tokenRevoked === '1' && <Banner tone="success">Agente revogado.</Banner>}
        {searchParams?.tokenError === '1' && <Banner tone="error">Não foi possível revogar o agente. Tente novamente.</Banner>}
        {searchParams?.logRequested === '1' && (
          <Banner tone="success">
            Log solicitado — o agente envia assim que perceber o pedido (até 2 minutos, se estiver online).
          </Banner>
        )}
        {searchParams?.logRequestError === '1' && (
          <Banner tone="error">Não foi possível solicitar o log. Tente novamente.</Banner>
        )}
        {searchParams?.commandRequested === '1' && (
          <Banner tone="success">
            Comando enviado — o agente executa assim que perceber o pedido (até 2 minutos, se estiver online).
          </Banner>
        )}
        {searchParams?.commandError === '1' && (
          <Banner tone="error">Não foi possível enviar o comando. Tente novamente.</Banner>
        )}

        {tokens.length === 0 ? (
          <p className="text-sm text-ink-faint">Nenhum agente instalado para este cliente ainda.</p>
        ) : (
          <ul className="divide-y divide-line border-t border-line">
            {tokens.map((t) => {
              const status = t.revokedAt ? null : commandStatus(t, tz);
              return (
              <li key={t.id} className="py-2.5 text-sm">
                <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-ink">{t.label || 'Sem rótulo'}</span>
                    {tokenStatusBadge(t)}
                  </div>
                  <div className="text-xs text-ink-faint">
                    criado em {formatDateTime(t.createdAt, tz)}
                    {t.lastCheckinAt && (
                      <>
                        {' '}
                        · última atividade em {formatDateTime(t.lastCheckinAt, tz)}
                        {t.lastSeenVersion && ` (v${t.lastSeenVersion})`}
                      </>
                    )}
                  </div>
                  {!t.revokedAt && logRequestPending(t) && (
                    <div className="text-xs text-ink-faint">Aguardando o agente enviar o log...</div>
                  )}
                  {!t.revokedAt && !logRequestPending(t) && t.logUploadedAt && (
                    <Link href={`/customers/${id}/agent-tokens/${t.id}/log`} className="text-xs text-accent hover:underline">
                      Ver log (enviado em {formatDateTime(t.logUploadedAt, tz)})
                    </Link>
                  )}
                </div>
                {t.revokedAt ? null : (
                  <div className="flex shrink-0 items-center gap-2">
                    <form action={boundRequestLog.bind(null, t.id)}>
                      <SubmitButton variant="secondary" size="sm" pendingLabel="Solicitando...">
                        Buscar log agora
                      </SubmitButton>
                    </form>
                    <form action={boundRevokeToken.bind(null, t.id)}>
                      <SubmitButton variant="danger" pendingLabel="Revogando...">
                        Revogar
                      </SubmitButton>
                    </form>
                  </div>
                )}
                </div>
                {!t.revokedAt && (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {supportsRemoteCommands(t.lastSeenVersion) ? (
                      (Object.keys(COMMAND_LABEL) as AgentCommandType[]).map((c) => (
                        <form key={c} action={boundRequestCommand.bind(null, t.id, c)}>
                          <SubmitButton variant="secondary" size="sm" pendingLabel="Enviando...">
                            {COMMAND_LABEL[c]}
                          </SubmitButton>
                        </form>
                      ))
                    ) : (
                      <span className="text-xs text-ink-faint">
                        Comandos remotos (reiniciar, atualizar, buscar impressoras) ficam disponíveis quando este
                        agente estiver na v0.1.13 ou mais nova — ele se atualiza sozinho em até 6 horas.
                      </span>
                    )}
                  </div>
                )}
                {status && <div className="mt-1 text-xs text-ink-faint">{status}</div>}
              </li>
              );
            })}
          </ul>
        )}
      </Panel>
      </>
      )}

      <div className="mt-6">
        <h2 className="mb-3 text-sm font-medium text-ink">Dispositivos</h2>
        {customerDevices.length === 0 ? (
          <p className="rounded-xl border border-dashed border-line p-5 text-sm text-ink-faint">
            Nenhum dispositivo atribuído ainda.
          </p>
        ) : (
          <DeviceFleetTable
            devices={customerDevices.map((d) => ({ ...d, health: deriveHealth(d.latestMetric) }))}
            isTenantWide={false}
            revenueByDeviceId={
              // Omitted (no column) when there's no active contract, or the
              // contract is FLAT_RATE - see DeviceFleetTable's prop comment
              // for why an all-zero column would be misleading there.
              currentPeriod.hasContract && currentPeriod.contract.pricingModel !== 'FLAT_RATE'
                ? new Map(currentPeriod.perDevice.map((d) => [d.deviceId, d.usageRevenue]))
                : undefined
            }
          />
        )}
      </div>
    </main>
  );
}
