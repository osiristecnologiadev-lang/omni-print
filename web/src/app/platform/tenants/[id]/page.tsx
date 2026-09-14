import Link from 'next/link';
import { getTenant, getTenantUsers } from '@/lib/platform-api';
import { getViewerTimeZone } from '@/lib/api';
import { createTenantUserAction, updateTenantPricingAction } from './actions';
import { PlainSubmitButton } from '@/components/SubmitButton';
import { PlatformBanner } from '@/components/Banner';

// Server Components render on Railway (UTC) - see getViewerTimeZone.
function formatDateTime(iso: string, timeZone?: string): string {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone }).format(new Date(iso));
}

const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const STANDARD_PRICE_PER_DEVICE_CENTS = 310; // mirrors api's trial.util.ts PRICE_PER_DEVICE_CENTS

const STATUS_CLASSES: Record<string, string> = {
  TRIALING: 'bg-sky-900/40 text-sky-300',
  ACTIVE: 'bg-emerald-900/40 text-emerald-300',
  PAST_DUE: 'bg-amber-900/40 text-amber-300',
  CANCELED: 'bg-red-900/40 text-red-300',
};
const STATUS_LABEL: Record<string, string> = {
  TRIALING: 'Teste',
  ACTIVE: 'Ativo',
  PAST_DUE: 'Pagamento pendente',
  CANCELED: 'Cancelado',
};

export default async function TenantDetailPage(props: PageProps<'/platform/tenants/[id]'>) {
  const { id } = await props.params;
  const searchParams = await props.searchParams;

  const [tenant, users, tz] = await Promise.all([getTenant(id), getTenantUsers(id), getViewerTimeZone()]);
  const boundCreateUser = createTenantUserAction.bind(null, id);
  const boundUpdatePricing = updateTenantPricingAction.bind(null, id);
  const effectivePriceCents = tenant.pricePerDeviceCentsOverride ?? STANDARD_PRICE_PER_DEVICE_CENTS;

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <Link href="/platform" className="text-sm text-gray-500 hover:text-gray-300">
        ← Empresas outsource
      </Link>

      <div className="mt-4 mb-1 flex items-center gap-3">
        <h1 className="text-2xl font-semibold text-gray-100">{tenant.name}</h1>
        <span
          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ${STATUS_CLASSES[tenant.subscriptionStatus]}`}
        >
          {STATUS_LABEL[tenant.subscriptionStatus]}
        </span>
      </div>
      <p className="mb-8 text-sm text-gray-400">
        {tenant._count?.customers ?? 0} cliente{(tenant._count?.customers ?? 0) === 1 ? '' : 's'} ·{' '}
        {tenant._count?.devices ?? 0} dispositivo{(tenant._count?.devices ?? 0) === 1 ? '' : 's'}
        {tenant.subscriptionStatus === 'ACTIVE' && <> · {currency.format(tenant.mrrCents / 100)}/mês</>}
      </p>

      <section className="mb-6 rounded-xl border border-gray-800 bg-gray-900/40 p-5">
        <h2 className="mb-1 text-sm font-medium text-gray-100">Preço negociado</h2>
        <p className="mb-4 text-xs text-gray-500">
          Padrão: {currency.format(STANDARD_PRICE_PER_DEVICE_CENTS / 100)}/dispositivo/mês. Deixe em branco para usar o
          padrão. Se esta empresa já tem assinatura ativa, o novo valor entra em vigor imediatamente (o Stripe ajusta a
          fatura do período atual proporcionalmente).
        </p>

        {searchParams?.priceSaved === '1' && <PlatformBanner tone="success">Preço atualizado.</PlatformBanner>}
        {searchParams?.priceError === '1' && (
          <PlatformBanner tone="error">Não foi possível atualizar o preço. Tente novamente.</PlatformBanner>
        )}

        <p className="mb-3 text-sm text-gray-300">
          Vigente agora: <span className="font-medium text-gray-100">{currency.format(effectivePriceCents / 100)}</span>
          /dispositivo/mês
          {tenant.pricePerDeviceCentsOverride == null && <span className="text-gray-500"> (padrão)</span>}
        </p>

        <form action={boundUpdatePricing} className="flex gap-2">
          <div className="relative flex-1">
            <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-gray-500">
              R$
            </span>
            <input
              name="pricePerDevice"
              placeholder={(STANDARD_PRICE_PER_DEVICE_CENTS / 100).toFixed(2).replace('.', ',')}
              defaultValue={tenant.pricePerDeviceCentsOverride != null ? (tenant.pricePerDeviceCentsOverride / 100).toFixed(2).replace('.', ',') : ''}
              className="w-full rounded-lg border border-gray-700 bg-gray-800 py-2 pr-3 pl-9 text-sm text-gray-100 outline-none transition-colors focus:border-amber-600"
            />
          </div>
          <PlainSubmitButton
            className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-amber-500"
            pendingLabel="Salvando..."
          >
            Salvar
          </PlainSubmitButton>
        </form>
      </section>

      <section className="rounded-xl border border-gray-800 bg-gray-900/40 p-5">
        <h2 className="mb-1 text-sm font-medium text-gray-100">Usuários</h2>
        <p className="mb-4 text-xs text-gray-500">
          Crie o primeiro login desta empresa (ela usa esse acesso para gerenciar os próprios clientes e
          dispositivos). Depois disso, a própria empresa cria os demais usuários pela conta dela.
        </p>

        {searchParams?.created === '1' && <PlatformBanner tone="success">Usuário criado.</PlatformBanner>}
        {searchParams?.error === 'email_in_use' && (
          <PlatformBanner tone="error">Já existe um usuário com esse e-mail.</PlatformBanner>
        )}
        {searchParams?.error === '1' && <PlatformBanner tone="error">Não foi possível criar o usuário.</PlatformBanner>}

        <form action={boundCreateUser} className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <input
            name="name"
            placeholder="Nome"
            className="rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 outline-none transition-colors focus:border-amber-600"
          />
          <input
            name="email"
            type="email"
            placeholder="E-mail"
            required
            className="rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 outline-none transition-colors focus:border-amber-600"
          />
          <input
            name="password"
            type="password"
            placeholder="Senha (mín. 8)"
            required
            minLength={8}
            className="rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 outline-none transition-colors focus:border-amber-600"
          />
          <PlainSubmitButton
            className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-amber-500 sm:col-span-3"
            pendingLabel="Criando..."
          >
            Criar usuário
          </PlainSubmitButton>
        </form>

        {users.length > 0 && (
          <ul className="mt-4 divide-y divide-gray-800 border-t border-gray-800">
            {users.map((u) => (
              <li key={u.id} className="flex items-center justify-between py-2.5 text-sm">
                <div>
                  <span className="text-gray-100">
                    {u.name || u.email}
                    {u.revokedAt && <span className="ml-2 text-xs text-gray-500">(revogado)</span>}
                  </span>
                  <div className="text-xs text-gray-500">
                    {u.email} · {u.customer ? u.customer.name : 'Equipe'} · criado em{' '}
                    {formatDateTime(u.createdAt, tz)}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
