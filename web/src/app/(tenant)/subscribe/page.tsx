import { getSubscriptionStatus } from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import { Panel } from '@/components/Panel';
import { Badge, type BadgeTone } from '@/components/Badge';
import { SubmitButton } from '@/components/SubmitButton';
import { Banner } from '@/components/Banner';
import { createCheckoutSessionAction } from './actions';

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
  const subscription = await getSubscriptionStatus();
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

      <Panel>
        <div className="mb-4 flex items-center justify-between">
          <span className="text-sm font-medium text-ink">Status</span>
          <Badge tone={STATUS_TONE[subscription.status]}>{STATUS_LABEL[subscription.status]}</Badge>
        </div>

        {subscription.status === 'TRIALING' && (
          <p className="mb-4 text-sm text-ink-muted">
            {trialDaysLeft > 0
              ? `Seu período de teste gratuito acaba em ${trialDaysLeft} dia${trialDaysLeft === 1 ? '' : 's'} (${formatDate(subscription.trialEndsAt)}).`
              : 'Seu período de teste gratuito acabou. Assine para continuar usando o OmniPrint.'}
          </p>
        )}
        {subscription.isBlocked && (
          <p className="mb-4 text-sm font-medium text-red-600 dark:text-red-400">
            O acesso está bloqueado para toda a sua empresa até a assinatura ser regularizada.
          </p>
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

        {subscription.status !== 'ACTIVE' && (
          <form action={createCheckoutSessionAction}>
            <SubmitButton variant="primary" pendingLabel="Redirecionando...">
              Assinar agora
            </SubmitButton>
          </form>
        )}
      </Panel>
    </main>
  );
}
