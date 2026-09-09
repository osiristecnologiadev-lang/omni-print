import { forbidden } from 'next/navigation';
import { getCustomers, getSession, getUsers, getViewerTimeZone } from '@/lib/api';
import { createUserAction, revokeUserAction } from './actions';
import { PageHeader } from '@/components/PageHeader';
import { Panel } from '@/components/Panel';
import { SubmitButton } from '@/components/SubmitButton';
import { Banner } from '@/components/Banner';

const fieldClass =
  'rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none transition-colors focus:border-accent';

// Server Components render on Railway (UTC) - see getViewerTimeZone.
function formatDateTime(iso: string, timeZone?: string): string {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone }).format(new Date(iso));
}

export default async function UsersPage(props: PageProps<'/users'>) {
  const session = await getSession();
  if (session?.customerId) {
    forbidden();
  }

  const searchParams = await props.searchParams;
  const errorParam = searchParams?.error;
  const created = searchParams?.created === '1';
  const revoked = searchParams?.revoked === '1';
  const revokeError = searchParams?.revokeError === '1';

  const [users, customers, tz] = await Promise.all([getUsers(), getCustomers(), getViewerTimeZone()]);

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <PageHeader
        title="Usuários"
        subtitle="Login sem cliente selecionado enxerga todos os clientes (equipe da sua empresa). Com um cliente selecionado, o login só vê os dispositivos daquele cliente."
      />

      {created && <Banner tone="success">Usuário criado.</Banner>}
      {errorParam === 'email_in_use' && <Banner tone="error">Já existe um usuário com esse e-mail.</Banner>}
      {errorParam === '1' && <Banner tone="error">Não foi possível criar o usuário. Confira os dados e tente novamente.</Banner>}
      {revoked && <Banner tone="success">Usuário revogado.</Banner>}
      {revokeError && <Banner tone="error">Não foi possível revogar o usuário. Tente novamente.</Banner>}

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
          <SubmitButton variant="primary" className="sm:col-span-2" pendingLabel="Criando...">
            Criar usuário
          </SubmitButton>
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
                {u.email} · {u.customer ? u.customer.name : 'Equipe'} · criado em {formatDateTime(u.createdAt, tz)}
              </div>
            </div>
            {!u.revokedAt && (
              <form action={revokeUserAction.bind(null, u.id)}>
                <SubmitButton variant="danger" pendingLabel="Revogando...">
                  Revogar
                </SubmitButton>
              </form>
            )}
          </li>
        ))}
      </ul>
    </main>
  );
}
