import { forbidden } from 'next/navigation';
import { getCustomers, getSession, getUsers } from '@/lib/api';
import { createUserAction, revokeUserAction } from './actions';
import { PageHeader } from '@/components/PageHeader';
import { Panel } from '@/components/Panel';
import { Button } from '@/components/Button';

const fieldClass =
  'rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none transition-colors focus:border-accent';

function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso));
}

export default async function UsersPage(props: PageProps<'/users'>) {
  const session = await getSession();
  if (session?.customerId) {
    forbidden();
  }

  const searchParams = await props.searchParams;
  const errorParam = searchParams?.error;
  const created = searchParams?.created === '1';

  const [users, customers] = await Promise.all([getUsers(), getCustomers()]);

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <PageHeader
        title="Usuários"
        subtitle="Login sem cliente selecionado enxerga todos os clientes (equipe da sua empresa). Com um cliente selecionado, o login só vê os dispositivos daquele cliente."
      />

      {created && (
        <p className="mb-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
          Usuário criado.
        </p>
      )}
      {errorParam === 'email_in_use' && (
        <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300">
          Já existe um usuário com esse e-mail.
        </p>
      )}
      {errorParam === '1' && (
        <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300">
          Não foi possível criar o usuário. Confira os dados e tente novamente.
        </p>
      )}

      <Panel>
        <form action={createUserAction} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <input name="name" placeholder="Nome" className={fieldClass} />
          <input name="email" type="email" placeholder="E-mail" required className={fieldClass} />
          <input name="password" type="password" placeholder="Senha (mín. 8 caracteres)" required minLength={8} className={fieldClass} />
          <select name="customerId" defaultValue="" className={fieldClass}>
            <option value="">Equipe (vê todos os clientes)</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <Button type="submit" variant="primary" className="sm:col-span-2">
            Criar usuário
          </Button>
        </form>
      </Panel>

      <ul className="mt-6 divide-y divide-line rounded-xl border border-line bg-surface">
        {users.map((u) => (
          <li key={u.id} className="flex items-center justify-between px-4 py-3 text-sm">
            <div>
              <div className="text-ink">
                {u.name || u.email}
                {u.revokedAt && <span className="ml-2 text-xs text-ink-faint">(revogado)</span>}
              </div>
              <div className="text-xs text-ink-faint">
                {u.email} · {u.customer ? u.customer.name : 'Equipe'} · criado em {formatDateTime(u.createdAt)}
              </div>
            </div>
            {!u.revokedAt && (
              <form action={revokeUserAction.bind(null, u.id)}>
                <Button type="submit" variant="danger">
                  Revogar
                </Button>
              </form>
            )}
          </li>
        ))}
      </ul>
    </main>
  );
}
