'use server';

import { redirect } from 'next/navigation';
import { createCheckoutSession } from '@/lib/api';

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
