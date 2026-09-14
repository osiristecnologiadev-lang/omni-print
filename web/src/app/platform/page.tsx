import Link from 'next/link';
import { getTenants } from '@/lib/platform-api';
import { getViewerTimeZone } from '@/lib/api';
import { createTenantAction } from './actions';
import { PlainSubmitButton } from '@/components/SubmitButton';
import { PlatformBanner } from '@/components/Banner';

// Server Components render on Railway (UTC) - see getViewerTimeZone.
function formatDateTime(iso: string, timeZone?: string): string {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeZone }).format(new Date(iso));
}

const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

// Raw Tailwind classes, not the tenant app's <Badge> component - the
// platform area is permanently dark and hand-rolls its own palette (see
// audit-log/page.tsx for the same convention), not the light/dark CSS
// tokens Badge relies on.
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

export default async function PlatformDashboard(props: PageProps<'/platform'>) {
  const searchParams = await props.searchParams;
  const [tenants, tz] = await Promise.all([getTenants(), getViewerTimeZone()]);
  const totalMrrCents = tenants.reduce((sum, t) => sum + t.mrrCents, 0);

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="mb-1 text-2xl font-semibold text-gray-100">Empresas outsource</h1>
      <p className="mb-6 text-sm text-gray-400">
        {tenants.length} empresa{tenants.length === 1 ? '' : 's'} usando a OmniPrint · MRR total{' '}
        <span className="font-medium text-gray-200">{currency.format(totalMrrCents / 100)}</span>
      </p>

      {searchParams?.created === '1' && <PlatformBanner tone="success">Empresa cadastrada.</PlatformBanner>}
      {searchParams?.error === '1' && (
        <PlatformBanner tone="error">Não foi possível cadastrar a empresa. Tente novamente.</PlatformBanner>
      )}

      <form action={createTenantAction} className="flex gap-2">
        <input
          name="name"
          placeholder="Nome da nova empresa outsource"
          required
          className="flex-1 rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 outline-none transition-colors focus:border-amber-600"
        />
        <PlainSubmitButton
          className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-amber-500"
          pendingLabel="Cadastrando..."
        >
          Cadastrar
        </PlainSubmitButton>
      </form>

      {tenants.length === 0 ? (
        <p className="mt-6 rounded-xl border border-dashed border-gray-700 p-8 text-center text-gray-500">
          Nenhuma empresa cadastrada ainda.
        </p>
      ) : (
        <ul className="mt-6 divide-y divide-gray-800 rounded-xl border border-gray-800 bg-gray-900/40">
          {tenants.map((t) => (
            <li key={t.id} className="flex items-center justify-between px-4 py-3">
              <div>
                <Link href={`/platform/tenants/${t.id}`} className="font-medium text-gray-100 hover:text-amber-400">
                  {t.name}
                </Link>
                <div className="text-xs text-gray-500">desde {formatDateTime(t.createdAt, tz)}</div>
              </div>
              <div className="flex items-center gap-3">
                <div className="text-right text-sm text-gray-400">
                  {t._count?.customers ?? 0} cliente{(t._count?.customers ?? 0) === 1 ? '' : 's'} ·{' '}
                  {t._count?.devices ?? 0} dispositivo{(t._count?.devices ?? 0) === 1 ? '' : 's'} ·{' '}
                  {t._count?.users ?? 0} usuário{(t._count?.users ?? 0) === 1 ? '' : 's'}
                  {t.subscriptionStatus === 'ACTIVE' && (
                    <span className="ml-1 tabular-nums text-gray-500">· {currency.format(t.mrrCents / 100)}/mês</span>
                  )}
                </div>
                <span
                  className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ${STATUS_CLASSES[t.subscriptionStatus]}`}
                >
                  {STATUS_LABEL[t.subscriptionStatus]}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
