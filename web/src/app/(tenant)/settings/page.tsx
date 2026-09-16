import { forbidden } from 'next/navigation';
import { getViewerAccess, getTenant, getApiKeys, getViewerTimeZone } from '@/lib/api';
import { hasPermission } from '@/lib/permissions';
import { BRAZIL_TIMEZONE_OPTIONS } from '@/lib/timezones';
import { updateTenantAction, uploadLogoAction, removeLogoAction, revokeApiKeyAction } from './actions';
import { CreateApiKeyForm } from './CreateApiKeyForm';
import { PageHeader } from '@/components/PageHeader';
import { Panel } from '@/components/Panel';
import { SubmitButton } from '@/components/SubmitButton';
import { Banner } from '@/components/Banner';

const inputClass =
  'mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none transition-colors focus:border-accent';

// Server Components render on Railway (UTC) - see getViewerTimeZone.
function formatDateTime(iso: string, timeZone?: string): string {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone }).format(new Date(iso));
}

export default async function SettingsPage(props: PageProps<'/settings'>) {
  const searchParams = await props.searchParams;

  const access = await getViewerAccess();
  if (!hasPermission(access, 'settings')) {
    forbidden();
  }

  const [tenant, apiKeys, tz] = await Promise.all([getTenant(), getApiKeys(), getViewerTimeZone()]);

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
          <label className="block text-xs text-ink-muted">
            Fuso horário
            <select name="timezone" defaultValue={tenant.timezone} className={inputClass}>
              {BRAZIL_TIMEZONE_OPTIONS.map((tz) => (
                <option key={tz.value} value={tz.value}>
                  {tz.label}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-xs text-ink-faint">
              Usado apenas nas datas que a fatura em PDF gera sozinha (emissão, pagamento). As telas do sistema já usam o fuso
              do seu navegador automaticamente.
            </span>
          </label>
          <SubmitButton variant="primary" pendingLabel="Salvando...">
            Salvar
          </SubmitButton>
        </form>
      </Panel>

      <div className="mt-10">
        <PageHeader title="Logo da empresa" subtitle="Aparece no cabeçalho da fatura em PDF gerada para os seus clientes." />
      </div>

      {searchParams?.logoSaved === '1' && <Banner tone="success">Logo atualizado.</Banner>}
      {searchParams?.logoRemoved === '1' && <Banner tone="success">Logo removido.</Banner>}
      {searchParams?.logoError === 'empty' && <Banner tone="error">Escolha um arquivo antes de enviar.</Banner>}
      {searchParams?.logoError === '1' && (
        <Banner tone="error">Não foi possível salvar o logo. Confira se é PNG ou JPEG e tente novamente.</Banner>
      )}

      <Panel>
        <div className="flex items-center gap-4">
          {tenant.logoFilePath ? (
            // eslint-disable-next-line @next/next/no-img-element -- proxied server image, not a Next-optimizable static asset
            <img
              src="/settings/logo"
              alt="Logo atual"
              className="h-16 w-16 rounded-lg border border-line object-contain bg-surface p-1"
            />
          ) : (
            <div className="flex h-16 w-16 items-center justify-center rounded-lg border border-dashed border-line text-xs text-ink-faint">
              Sem logo
            </div>
          )}
          <div className="flex-1">
            <form action={uploadLogoAction} encType="multipart/form-data" className="flex flex-wrap items-center gap-2">
              <input
                type="file"
                name="logo"
                accept="image/png,image/jpeg"
                required
                className="text-sm text-ink-muted file:mr-2 file:rounded-lg file:border file:border-line file:bg-surface file:px-3 file:py-1.5 file:text-sm file:text-ink"
              />
              <SubmitButton variant="secondary" size="sm" pendingLabel="Enviando...">
                {tenant.logoFilePath ? 'Substituir' : 'Enviar'}
              </SubmitButton>
            </form>
            <p className="mt-1 text-xs text-ink-faint">PNG ou JPEG, até 2MB.</p>
          </div>
          {tenant.logoFilePath && (
            <form action={removeLogoAction}>
              <SubmitButton variant="danger" size="sm" pendingLabel="Removendo...">
                Remover
              </SubmitButton>
            </form>
          )}
        </div>
      </Panel>

      <div className="mt-10">
        <PageHeader
          title="Chaves de API"
          subtitle="Acesso somente-leitura para uma integração externa consultar dispositivos, clientes, faturas e o relatório de uso/receita do seu próprio parque, sem passar pelo login."
        />
      </div>

      {searchParams?.apiKeyRevoked === '1' && <Banner tone="success">Chave revogada.</Banner>}
      {searchParams?.apiKeyError === '1' && <Banner tone="error">Não foi possível revogar a chave. Tente novamente.</Banner>}

      <Panel>
        <CreateApiKeyForm />

        {apiKeys.length > 0 && (
          <ul className="mt-4 divide-y divide-line rounded-lg border border-line">
            {apiKeys.map((k) => (
              <li key={k.id} className="flex items-center justify-between px-3 py-2 text-sm">
                <div>
                  <div className="text-ink">
                    {k.label || 'Sem rótulo'}
                    {k.revokedAt && <span className="ml-2 text-xs text-ink-faint">(revogada)</span>}
                  </div>
                  <div className="text-xs text-ink-faint">
                    criada em {formatDateTime(k.createdAt, tz)}
                    {k.lastUsedAt ? ` · último uso ${formatDateTime(k.lastUsedAt, tz)}` : ' · nunca usada'}
                  </div>
                </div>
                {!k.revokedAt && (
                  <form action={revokeApiKeyAction.bind(null, k.id)}>
                    <SubmitButton variant="danger" size="sm" pendingLabel="Revogando...">
                      Revogar
                    </SubmitButton>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </main>
  );
}
