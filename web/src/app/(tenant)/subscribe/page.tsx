import { getSession, getSubscriptionStatus, getSubscriptionInvoices } from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import { Panel } from '@/components/Panel';
import { Badge, type BadgeTone } from '@/components/Badge';
import { SubmitButton } from '@/components/SubmitButton';
import { Banner } from '@/components/Banner';
import { buttonClasses } from '@/components/Button';
import { createCheckoutSessionAction, cancelSubscriptionAction, reactivateSubscriptionAction } from './actions';
import { PaymentMethodForm } from './PaymentMethodForm';

const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeZone: 'UTC' }).format(new Date(iso));
}

const STATUS_TONE: Record<string, BadgeTone> = {
  TRIALING: 'info',
  ACTIVE: 'ok',
  PAST_DUE: 'warning',
  CANCELED: 'critical',
};

const STATUS_LABEL: Record<string, string> = {
  TRIALING: 'Período de teste',
  ACTIVE: 'Assinatura ativa',
  PAST_DUE: 'Pagamento pendente',
  CANCELED: 'Assinatura cancelada',
};

// Deliberately not permission-gated (unlike every other tenant page) and
// reachable even when the tenant is blocked - see api's SubscriptionGuard,
// which excludes SubscriptionController. This is how a blocked tenant
// (including a customer-scoped login, per the 2026-09-14 "block everyone"
// decision) finds out why and how to fix it.
export default async function SubscribePage(props: PageProps<'/subscribe'>) {
  const searchParams = await props.searchParams;
  const session = await getSession();
  if (!session) return null;
  const isTenantWide = !session.customerId;

  const subscription = await getSubscriptionStatus();
  // Invoice history/cancel/payment-method are staff-only on the backend
  // (billing is a company-level concern, not the outsource's own client's -
  // see SubscriptionController.requireTenantWide) - only fetched here for a
  // tenant-wide viewer, so a customer-scoped session never hits a 403 just
  // from loading this page.
  const invoices = isTenantWide ? await getSubscriptionInvoices() : [];
  const trialDaysLeft = Math.ceil((new Date(subscription.trialEndsAt).getTime() - Date.now()) / 86_400_000);

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <PageHeader title="Assinatura do OmniPrint" subtitle="Cobrança por dispositivo monitorado, sem taxa mínima." />

      {searchParams?.checkout === 'success' && (
        <Banner tone="success">
          Pagamento recebido pelo Stripe. Pode levar alguns instantes até a assinatura aparecer como ativa aqui.
        </Banner>
      )}
      {searchParams?.checkout === 'cancelled' && <Banner tone="info">Assinatura não concluída.</Banner>}
      {searchParams?.error === '1' && <Banner tone="error">Não foi possível iniciar o checkout. Tente novamente.</Banner>}
      {searchParams?.cancelled === '1' && (
        <Banner tone="success">Cancelamento agendado. Você continua com acesso até o fim do período já pago.</Banner>
      )}
      {searchParams?.cancelError === '1' && <Banner tone="error">Não foi possível cancelar a assinatura. Tente novamente.</Banner>}
      {searchParams?.reactivated === '1' && <Banner tone="success">Cancelamento desfeito - sua assinatura continua normalmente.</Banner>}
      {searchParams?.reactivateError === '1' && <Banner tone="error">Não foi possível reativar a assinatura. Tente novamente.</Banner>}

      <Panel>
        <div className="mb-4 flex items-center justify-between">
          <span className="text-sm font-medium text-ink">Status</span>
          {subscription.isComped ? (
            <Badge tone="ok">Cortesia</Badge>
          ) : (
            <Badge tone={STATUS_TONE[subscription.status]}>{STATUS_LABEL[subscription.status]}</Badge>
          )}
        </div>

        {subscription.isComped && (
          <p className="mb-4 text-sm text-ink-muted">
            Sua empresa tem acesso liberado sem cobrança por enquanto, combinado diretamente com a OmniPrint.
          </p>
        )}
        {!subscription.isComped && subscription.status === 'TRIALING' && (
          <p className="mb-4 text-sm text-ink-muted">
            {trialDaysLeft > 0
              ? `Seu período de teste gratuito acaba em ${trialDaysLeft} dia${trialDaysLeft === 1 ? '' : 's'} (${formatDate(subscription.trialEndsAt)}).`
              : 'Seu período de teste gratuito acabou. Assine para continuar usando o OmniPrint.'}
          </p>
        )}
        {!subscription.isComped && subscription.isBlocked && (
          <p className="mb-4 text-sm font-medium text-red-600 dark:text-red-400">
            O acesso está bloqueado para toda a sua empresa até a assinatura ser regularizada.
          </p>
        )}
        {!subscription.isComped && subscription.cancelAtPeriodEnd && (
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-900/30">
            <p className="text-sm text-amber-800 dark:text-amber-300">
              Cancelamento agendado{subscription.currentPeriodEnd ? ` para ${formatDate(subscription.currentPeriodEnd)}` : ''}.
              Você mantém acesso normal até essa data.
            </p>
            {isTenantWide && (
              <form action={reactivateSubscriptionAction}>
                <SubmitButton variant="secondary" pendingLabel="Reativando...">
                  Desfazer cancelamento
                </SubmitButton>
              </form>
            )}
          </div>
        )}

        <div className="mb-5 rounded-lg border border-line bg-surface-2 p-4">
          <div className="flex items-center justify-between text-sm">
            <span className="text-ink-muted">Dispositivos monitorados</span>
            <span className="tabular-nums text-ink">{subscription.deviceCount}</span>
          </div>
          <div className="mt-1 flex items-center justify-between text-sm">
            <span className="text-ink-muted">Preço por dispositivo</span>
            <span className="tabular-nums text-ink">{currency.format(subscription.pricePerDeviceCents / 100)}/mês</span>
          </div>
          <div className="mt-2 flex items-center justify-between border-t border-line pt-2 text-sm font-medium">
            <span className="text-ink">Estimativa mensal</span>
            <span className="tabular-nums text-ink">{currency.format(subscription.estimatedMonthlyCents / 100)}</span>
          </div>
          <p className="mt-2 text-xs text-ink-faint">
            Sem taxa mínima - a cobrança acompanha exatamente a quantidade de dispositivos monitorados, ajustada
            automaticamente quando ela muda.
          </p>
        </div>

        {!subscription.isComped && subscription.status !== 'ACTIVE' && isTenantWide && (
          <form action={createCheckoutSessionAction}>
            <SubmitButton variant="primary" pendingLabel="Redirecionando...">
              Assinar agora
            </SubmitButton>
          </form>
        )}

        {!subscription.isComped && subscription.status === 'ACTIVE' && !subscription.cancelAtPeriodEnd && isTenantWide && (
          <form action={cancelSubscriptionAction}>
            <button type="submit" className={buttonClasses('danger')}>
              Cancelar assinatura
            </button>
          </form>
        )}
      </Panel>

      {/* Payment method and invoice history are staff-only (see the
          page-level isTenantWide fetch guard above) - a customer-scoped
          session never even sees these panels, not just a disabled state. */}
      {isTenantWide && !subscription.isComped && (
        <Panel className="mt-6">
          <h2 className="mb-3 text-sm font-medium text-ink">Método de pagamento</h2>
          {subscription.paymentMethod ? (
            <p className="mb-3 text-sm text-ink-muted">
              Cartão {subscription.paymentMethod.brand.toUpperCase()} terminado em {subscription.paymentMethod.last4}
            </p>
          ) : (
            <p className="mb-3 text-sm text-ink-faint">Nenhum cartão salvo ainda.</p>
          )}
          <PaymentMethodForm />
        </Panel>
      )}

      {isTenantWide && invoices.length > 0 && (
        <Panel className="mt-6">
          <h2 className="mb-3 text-sm font-medium text-ink">Faturas</h2>
          <div className="space-y-2">
            {invoices.map((inv) => (
              <div key={inv.id} className="flex items-center justify-between gap-3 rounded-lg bg-surface-2 p-3 text-sm">
                <div>
                  <span className="text-ink">{inv.number ?? inv.id}</span>
                  <span className="ml-2 text-xs text-ink-faint">{formatDate(inv.createdAt)}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="tabular-nums text-ink-muted">{currency.format(inv.amountPaidCents / 100)}</span>
                  {inv.invoicePdf && (
                    <a href={inv.invoicePdf} target="_blank" rel="noopener noreferrer" className={buttonClasses('ghost')}>
                      PDF
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Panel>
      )}
    </main>
  );
}
