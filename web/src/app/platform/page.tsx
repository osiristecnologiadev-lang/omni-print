import Link from 'next/link';
import { getTenants } from '@/lib/platform-api';
import { createTenantAction } from './actions';

function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' }).format(new Date(iso));
}

export default async function PlatformDashboard() {
  const tenants = await getTenants();

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="mb-1 text-2xl font-semibold text-gray-100">Empresas outsource</h1>
      <p className="mb-6 text-sm text-gray-400">
        {tenants.length} empresa{tenants.length === 1 ? '' : 's'} usando a OmniPrint.
      </p>

      <form action={createTenantAction} className="flex gap-2">
        <input
          name="name"
          placeholder="Nome da nova empresa outsource"
          required
          className="flex-1 rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 outline-none transition-colors focus:border-amber-600"
        />
        <button
          type="submit"
          className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-amber-500"
        >
          Cadastrar
        </button>
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
                <div className="text-xs text-gray-500">desde {formatDateTime(t.createdAt)}</div>
              </div>
              <div className="text-sm text-gray-400">
                {t._count?.customers ?? 0} cliente{(t._count?.customers ?? 0) === 1 ? '' : 's'} ·{' '}
                {t._count?.devices ?? 0} dispositivo{(t._count?.devices ?? 0) === 1 ? '' : 's'} ·{' '}
                {t._count?.users ?? 0} usuário{(t._count?.users ?? 0) === 1 ? '' : 's'}
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
