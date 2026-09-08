import Link from 'next/link';
import { getTenant, getTenantUsers } from '@/lib/platform-api';
import { createTenantUserAction } from './actions';
import { PlainSubmitButton } from '@/components/SubmitButton';
import { PlatformBanner } from '@/components/Banner';

function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso));
}

export default async function TenantDetailPage(props: PageProps<'/platform/tenants/[id]'>) {
  const { id } = await props.params;
  const searchParams = await props.searchParams;

  const [tenant, users] = await Promise.all([getTenant(id), getTenantUsers(id)]);
  const boundCreateUser = createTenantUserAction.bind(null, id);

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <Link href="/platform" className="text-sm text-gray-500 hover:text-gray-300">
        ← Empresas outsource
      </Link>

      <h1 className="mt-4 mb-1 text-2xl font-semibold text-gray-100">{tenant.name}</h1>
      <p className="mb-8 text-sm text-gray-400">
        {tenant._count?.customers ?? 0} cliente{(tenant._count?.customers ?? 0) === 1 ? '' : 's'} ·{' '}
        {tenant._count?.devices ?? 0} dispositivo{(tenant._count?.devices ?? 0) === 1 ? '' : 's'}
      </p>

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
                    {formatDateTime(u.createdAt)}
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
