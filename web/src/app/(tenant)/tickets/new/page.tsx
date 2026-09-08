import { getSession, getCustomers, getDevices, getCustomer, type Device } from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import { Panel } from '@/components/Panel';
import { SubmitButton } from '@/components/SubmitButton';
import { Banner } from '@/components/Banner';
import { createTicketAction } from '../actions';

const inputClass =
  'mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none transition-colors focus:border-accent';
const selectClass = inputClass;

// The customer picking a device needs to recognize it from three angles at
// once: the apelido the outsource admin gave it (if any), the name the
// printer itself reports over SNMP (what's actually printed on/known in
// their own office), and the IP - since a client's staff often only knows
// their printer by "a da recepção" or by its address, not any of these in
// isolation.
function deviceOptionLabel(d: Pick<Device, 'customLabel' | 'printerName' | 'name' | 'host'>): string {
  const captured = d.printerName ?? d.name ?? 'Sem nome capturado';
  return d.customLabel ? `${d.customLabel} — ${captured} — ${d.host}` : `${captured} — ${d.host}`;
}

export default async function NewTicketPage(props: PageProps<'/tickets/new'>) {
  const searchParams = await props.searchParams;
  const session = await getSession();
  if (!session) return null;

  const isTenantWide = !session.customerId;
  const chosenCustomerId = isTenantWide ? (searchParams?.customerId as string | undefined) : (session.customerId as string);

  if (isTenantWide && !chosenCustomerId) {
    const customers = await getCustomers();
    return (
      <main className="mx-auto max-w-lg px-6 py-10">
        <PageHeader title="Abrir chamado" subtitle="Selecione o cliente para quem o chamado é." />
        <Panel>
          <form method="get" className="space-y-4">
            <label className="block text-xs text-ink-muted">
              Cliente
              <select name="customerId" defaultValue="" className={`mt-1 ${selectClass}`} required>
                <option value="" disabled>
                  Selecione...
                </option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <SubmitButton variant="primary" pendingLabel="Continuando...">
              Continuar
            </SubmitButton>
          </form>
        </Panel>
      </main>
    );
  }

  const customerId = chosenCustomerId as string;
  // getCustomer is tenant-wide-only on the backend - only fetch it for the
  // subtitle when we're actually in the tenant-wide flow. A customer-scoped
  // user already knows who they are, and this call would 403 for them.
  const [customer, devices] = await Promise.all([
    isTenantWide ? getCustomer(customerId) : Promise.resolve(null),
    getDevices(),
  ]);
  const customerDevices = devices.filter((d) => d.customerId === customerId);
  const boundCreate = createTicketAction.bind(null, customerId);

  return (
    <main className="mx-auto max-w-lg px-6 py-10">
      <PageHeader title="Abrir chamado" subtitle={customer ? `Para: ${customer.name}` : undefined} />
      {searchParams?.error === '1' && (
        <Banner tone="error">Não foi possível abrir o chamado. Confira os dados e tente novamente.</Banner>
      )}
      <Panel>
        <form action={boundCreate} className="space-y-4">
          <label className="block text-xs text-ink-muted">
            Assunto
            <input name="subject" required minLength={3} className={inputClass} placeholder="Ex: Impressora atolando" />
          </label>
          <label className="block text-xs text-ink-muted">
            Descrição
            <textarea
              name="description"
              required
              minLength={3}
              rows={5}
              className={inputClass}
              placeholder="Descreva o problema com o máximo de detalhes possível."
            />
          </label>
          <label className="block text-xs text-ink-muted">
            Prioridade
            <select name="priority" defaultValue="MEDIUM" className={`mt-1 ${selectClass}`}>
              <option value="LOW">Baixa</option>
              <option value="MEDIUM">Média</option>
              <option value="HIGH">Alta</option>
              <option value="URGENT">Urgente</option>
            </select>
          </label>
          {customerDevices.length > 0 && (
            <label className="block text-xs text-ink-muted">
              Impressora (opcional)
              <select name="deviceId" defaultValue="" className={`mt-1 ${selectClass}`}>
                <option value="">Nenhuma específica</option>
                {customerDevices.map((d) => (
                  <option key={d.id} value={d.id}>
                    {deviceOptionLabel(d)}
                  </option>
                ))}
              </select>
              <span className="mt-1 block text-xs text-ink-faint">Apelido — nome capturado da impressora — IP</span>
            </label>
          )}
          <SubmitButton variant="primary" pendingLabel="Abrindo...">
            Abrir chamado
          </SubmitButton>
        </form>
      </Panel>
    </main>
  );
}
