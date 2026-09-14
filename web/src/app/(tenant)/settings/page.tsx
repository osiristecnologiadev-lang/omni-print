import { forbidden } from 'next/navigation';
import { getViewerAccess, getTenant } from '@/lib/api';
import { hasPermission } from '@/lib/permissions';
import { updateTenantAction } from './actions';
import { PageHeader } from '@/components/PageHeader';
import { Panel } from '@/components/Panel';
import { SubmitButton } from '@/components/SubmitButton';
import { Banner } from '@/components/Banner';

const inputClass =
  'mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none transition-colors focus:border-accent';

export default async function SettingsPage(props: PageProps<'/settings'>) {
  const searchParams = await props.searchParams;

  const access = await getViewerAccess();
  if (!hasPermission(access, 'settings')) {
    forbidden();
  }

  const tenant = await getTenant();

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <PageHeader
        title="Dados da empresa"
        subtitle='Essas informações aparecem como o emissor ("prestador") nas faturas geradas para os seus clientes.'
      />

      {searchParams?.saved === '1' && <Banner tone="success">Dados salvos.</Banner>}
      {searchParams?.error === '1' && <Banner tone="error">Não foi possível salvar os dados. Tente novamente.</Banner>}

      <Panel>
        <form action={updateTenantAction} className="space-y-4">
          <label className="block text-xs text-ink-muted">
            Razão social / nome
            <input name="name" defaultValue={tenant.name} required className={inputClass} />
          </label>
          <label className="block text-xs text-ink-muted">
            CNPJ/CPF
            <input name="document" defaultValue={tenant.document ?? ''} placeholder="00.000.000/0001-00" className={inputClass} />
          </label>
          <label className="block text-xs text-ink-muted">
            Endereço
            <input
              name="address"
              defaultValue={tenant.address ?? ''}
              placeholder="Rua Exemplo, 100 - Cidade/UF"
              className={inputClass}
            />
          </label>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="block text-xs text-ink-muted">
              Telefone
              <input name="phone" defaultValue={tenant.phone ?? ''} placeholder="(11) 4000-0000" className={inputClass} />
            </label>
            <label className="block text-xs text-ink-muted">
              E-mail de contato
              <input
                name="contactEmail"
                type="email"
                defaultValue={tenant.contactEmail ?? ''}
                placeholder="financeiro@suaempresa.com.br"
                className={inputClass}
              />
              <span className="mt-1 block text-xs text-ink-faint">
                Usado apenas nas faturas geradas para os seus clientes. As notificações do sistema ficam em{' '}
                <a href="/notifications" className="text-accent hover:underline">
                  Notificações
                </a>
                .
              </span>
            </label>
          </div>
          <SubmitButton variant="primary" pendingLabel="Salvando...">
            Salvar
          </SubmitButton>
        </form>
      </Panel>
    </main>
  );
}
