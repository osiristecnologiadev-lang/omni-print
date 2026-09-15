'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createCheckoutSession, cancelSubscription, reactivateSubscription, createSetupIntent, confirmPaymentMethod } from '@/lib/api';

export async function createCheckoutSessionAction() {
  let url: string;
  try {
    ({ url } = await createCheckoutSession());
  } catch {
    redirect('/subscribe?error=1');
  }

  // Stripe's hosted Checkout - an external absolute URL, which Next's
  // redirect() supports the same as an internal path.
  redirect(url);
}

export async function cancelSubscriptionAction() {
  try {
    await cancelSubscription();
  } catch {
    redirect('/subscribe?cancelError=1');
  }
  revalidatePath('/subscribe');
  redirect('/subscribe?cancelled=1');
}

export async function reactivateSubscriptionAction() {
  try {
    await reactivateSubscription();
  } catch {
    redirect('/subscribe?reactivateError=1');
  }
  revalidatePath('/subscribe');
  redirect('/subscribe?reactivated=1');
}

// Called imperatively from PaymentMethodForm.tsx (a client component), not
// via a <form action>, since Stripe.js confirmation steps have to happen
// client-side, between these two calls - so these return a plain result
// object instead of redirecting, letting the client component drive its
// own error/success UI.
export async function createSetupIntentAction(): Promise<{ clientSecret: string } | { error: string }> {
  try {
    return await createSetupIntent();
  } catch {
    return { error: 'Não foi possível iniciar a troca de cartão. Tente novamente.' };
  }
}

export async function confirmPaymentMethodAction(paymentMethodId: string): Promise<{ ok: true } | { error: string }> {
  try {
    await confirmPaymentMethod(paymentMethodId);
  } catch {
    return { error: 'O cartão foi validado pelo Stripe, mas não foi possível salvá-lo. Tente novamente.' };
  }
  revalidatePath('/subscribe');
  return { ok: true };
}
