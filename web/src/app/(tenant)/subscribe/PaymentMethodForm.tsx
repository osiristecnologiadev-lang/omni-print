'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { loadStripe, type Stripe as StripeJs } from '@stripe/stripe-js';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { buttonClasses } from '@/components/Button';
import { createSetupIntentAction, confirmPaymentMethodAction } from './actions';

// The one deliberate exception to this app's "no client JS by default"
// rule (see web UX pass notes) - capturing raw card data has to happen
// inside Stripe's own iframe (Stripe Elements), which needs Stripe.js
// running in the browser. Everything still lives on our own page/URL - no
// redirect to a stripe.com domain, unlike the initial subscribe Checkout
// flow, which stays hosted-redirect since that one's a one-time action, not
// something worth the added client JS for.
let stripePromise: Promise<StripeJs | null> | null = null;
function getStripe() {
  if (!stripePromise) {
    const key = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
    stripePromise = key ? loadStripe(key) : Promise.resolve(null);
  }
  return stripePromise;
}

function CardForm({ onDone }: { onDone: () => void }) {
  const stripe = useStripe();
  const elements = useElements();
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // PaymentElement's own load failure (distinct from a confirmSetup error
  // below, which only happens after a real submit attempt) - most commonly
  // an ad blocker or privacy extension blocking Stripe's own scripts
  // (js.stripe.com/m.stripe.network), not a bug in this app. Surfaced with
  // a message that says so, instead of leaving the visitor staring at a
  // blank/broken card field with only a swallowed console error.
  const [loadError, setLoadError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!stripe || !elements) return;
    setSubmitting(true);
    setError(null);

    // if_required: most cards don't need a redirect-based extra
    // authentication step (3D Secure) - only actually leaves the page for
    // the rare card that does, and comes right back.
    const { error: confirmError, setupIntent } = await stripe.confirmSetup({ elements, redirect: 'if_required' });
    if (confirmError) {
      setError(confirmError.message ?? 'Não foi possível validar o cartão.');
      setSubmitting(false);
      return;
    }

    const paymentMethodId =
      typeof setupIntent.payment_method === 'string' ? setupIntent.payment_method : setupIntent.payment_method?.id;
    if (!paymentMethodId) {
      setError('O Stripe não retornou o cartão validado. Tente novamente.');
      setSubmitting(false);
      return;
    }

    const result = await confirmPaymentMethodAction(paymentMethodId);
    setSubmitting(false);
    if ('error' in result) {
      setError(result.error);
      return;
    }
    router.refresh();
    onDone();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <PaymentElement
        onLoadError={(event) => setLoadError(event.error.message ?? 'Falha desconhecida ao carregar o formulário do Stripe.')}
      />
      {loadError && (
        <p className="text-sm text-red-600 dark:text-red-400">
          Não foi possível carregar o formulário de cartão ({loadError}). Se você usa bloqueador de anúncios/rastreadores
          (uBlock, Brave Shields, etc.), tente desativá-lo para este site ou usar uma aba anônima.
        </p>
      )}
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={!stripe || submitting} className={buttonClasses('primary')}>
          {submitting ? 'Salvando...' : 'Salvar cartão'}
        </button>
        <button type="button" onClick={onDone} className={buttonClasses('ghost')}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

export function PaymentMethodForm() {
  const [state, setState] = useState<'idle' | 'loading' | { clientSecret: string } | { error: string }>('idle');

  async function open() {
    setState('loading');
    const result = await createSetupIntentAction();
    setState('error' in result ? { error: result.error } : { clientSecret: result.clientSecret });
  }

  if (state === 'idle') {
    return (
      <button type="button" onClick={open} className={buttonClasses('secondary')}>
        Trocar cartão
      </button>
    );
  }

  if (state === 'loading') {
    return <p className="text-sm text-ink-faint">Carregando formulário do Stripe...</p>;
  }

  if ('error' in state) {
    return (
      <div>
        <p className="mb-2 text-sm text-red-600 dark:text-red-400">{state.error}</p>
        <button type="button" onClick={open} className={buttonClasses('secondary')}>
          Tentar de novo
        </button>
      </div>
    );
  }

  return (
    <Elements stripe={getStripe()} options={{ clientSecret: state.clientSecret }}>
      <CardForm onDone={() => setState('idle')} />
    </Elements>
  );
}
