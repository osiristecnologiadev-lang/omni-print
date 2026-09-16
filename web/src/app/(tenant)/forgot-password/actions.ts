'use server';

import { redirect } from 'next/navigation';

const API_BASE_URL = process.env.API_BASE_URL ?? 'http://localhost:3000';

export async function requestPasswordResetAction(formData: FormData) {
  const email = String(formData.get('email') ?? '');

  // Fire-and-forget on the frontend side too: the API already returns the
  // same generic response whether or not the email matched a real account
  // (see AuthController.forgotPassword), so there's nothing here to branch
  // on - always land on the "check your email" state.
  await fetch(`${API_BASE_URL}/v1/auth/forgot-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
    cache: 'no-store',
  }).catch(() => undefined);

  redirect('/forgot-password?sent=1');
}
