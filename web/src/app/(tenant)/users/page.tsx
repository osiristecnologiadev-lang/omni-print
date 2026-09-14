import { forbidden } from 'next/navigation';
import { getCustomers, getViewerAccess, getUsers, getViewerTimeZone } from '@/lib/api';
import { hasPermission, permissionLabel, TENANT_PERMISSION_OPTIONS } from '@/lib/permissions';
import { createUserAction, revokeUserAction, updateUserPermissionsAction } from './actions';
import { PermissionsFields } from './PermissionsFields';
import { PageHeader } from '@/components/PageHeader';
import { Panel } from '@/components/Panel';
import { Badge } from '@/components/Badge';
import { SubmitButton } from '@/components/SubmitButton';
import { Banner } from '@/components/Banner';

const fieldClass =
  'rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none transition-colors focus:border-accent';

// Server Components render on Railway (UTC) - see getViewerTimeZone.
function formatDateTime(iso: string, timeZone?: string): string {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone }).format(new Date(iso));
}

export default async function UsersPage(props: PageProps<'/users'>) {
  const access = await getViewerAccess();
  if (!hasPermission(access, 'users')) {
    forbidden();
  }

  const searchParams = await props.searchParams;
  const errorParam = searchParams?.error;
  const created = searchParams?.created === '1';
  const revoked = searchParams?.revoked === '1';
  const revokeError = searchParams?.revokeError === '1';
  const permissionsSaved = searchParams?.permissionsSaved === '1';
  const permissionsError = searchParams?.permissionsError === '1';

  const [users, customers, tz] = await Promise.all([getUsers(), getCustomers(), getViewerTimeZone()]);

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <PageHeader
        title="Usuários"
        subtitle="Login sem cliente selecionado enxerga todos os clientes (equipe da sua empresa). Com um cliente selecionado, o login só vê os dispositivos daquele cliente. Os módulos marcados abaixo controlam o que cada um pode acessar."
      />

      {created && <Banner tone="success">Usuário criado.</Banner>}
      {errorParam === 'email_in_use' && <Banner tone="error">Já existe um usuário com esse e-mail.</Banner>}
      {errorParam === '1' && <Banner tone="error">Não foi possível criar o usuário. Confira os dados e tente novamente.</Banner>}
      {revoked && <Banner tone="success">Usuário revogado.</Banner>}
      {revokeError && <Banner tone="error">Não foi possível revogar o usuário. Tente novamente.</Banner>}
      {permissionsSaved && <Banner tone="success">Permissões atualizadas.</Banner>}
      {permissionsError && <Banner tone="error">Não foi possível salvar as permissões. Tente novamente.</Banner>}

      <Panel>
        <form action={createUserAction} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <input name="name" placeholder="Nome" className={fieldClass} />
          <input name="email" type="email" placeholder="E-mail" required className={fieldClass} />
          <input name="password" type="password" placeholder="Senha (mín. 8 caracteres)" required minLength={8} className={fieldClass} />
          <PermissionsFields customers={customers} />
          <SubmitButton variant="primary" className="sm:col-span-2" pendingLabel="Criando...">
            Criar usuário
          </SubmitButton>
        </form>
      </Panel>

      <ul className="mt-6 divide-y divide-line rounded-xl border border-line bg-surface">
        {users.map((u) => {
          // The assignable key set is already fixed by this user's own
          // (immutable) customerId - no client-side reactivity needed here,
          // unlike the create form's PermissionsFields.
          const assignableKeys: readonly string[] = u.customerId ? ['invoices_view'] : TENANT_PERMISSION_OPTIONS;
          const boundUpdatePermissions = updateUserPermissionsAction.bind(null, u.id);
          return (
            <li key={u.id} className="px-4 py-3 text-sm">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-ink">
                    {u.name || u.email}
                    {u.revokedAt && <span className="ml-2 text-xs text-ink-faint">(revogado)</span>}
                  </div>
                  <div className="text-xs text-ink-faint">
                    {u.email} · {u.customer ? u.customer.name : 'Equipe'} · criado em {formatDateTime(u.createdAt, tz)}
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {u.permissions.length === 0 ? (
                      <span className="text-xs text-ink-faint">nenhum módulo</span>
                    ) : (
                      u.permissions.map((p) => (
                        <Badge key={p} tone="neutral">
                          {permissionLabel(p)}
                        </Badge>
                      ))
                    )}
                  </div>
                </div>
                {!u.revokedAt && (
                  <form action={revokeUserAction.bind(null, u.id)}>
                    <SubmitButton variant="danger" pendingLabel="Revogando...">
                      Revogar
                    </SubmitButton>
                  </form>
                )}
              </div>

              {!u.revokedAt && (
                <details className="mt-2">
                  <summary className="cursor-pointer text-xs font-medium text-accent">Editar permissões</summary>
                  <form action={boundUpdatePermissions} className="mt-2 rounded-lg border border-line p-3">
                    <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                      {assignableKeys.map((key) => (
                        <label key={key} className="flex items-center gap-2 text-sm text-ink">
                          <input
                            type="checkbox"
                            name="permissions"
                            value={key}
                            defaultChecked={u.permissions.includes(key)}
                            className="h-4 w-4"
                          />
                          {permissionLabel(key)}
                        </label>
                      ))}
                    </div>
                    <SubmitButton variant="secondary" size="sm" className="mt-3" pendingLabel="Salvando...">
                      Salvar permissões
                    </SubmitButton>
                  </form>
                </details>
              )}
            </li>
          );
        })}
      </ul>
    </main>
  );
}
