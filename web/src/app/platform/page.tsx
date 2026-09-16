import { getTenants } from '@/lib/platform-api';
import { getViewerTimeZone } from '@/lib/api';
import { createTenantAction } from './actions';
import { PlainSubmitButton } from '@/components/SubmitButton';
import { PlatformBanner } from '@/components/Banner';
import { TenantList } from './TenantList';

const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

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
        <TenantList tenants={tenants} tz={tz} />
      )}
    </main>
  );
}
