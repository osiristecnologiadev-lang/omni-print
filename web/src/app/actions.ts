'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE } from '@/lib/api';

const API_BASE_URL = process.env.API_BASE_URL ?? 'http://localhost:3000';

// Mirrors (tenant)/login/actions.ts's loginAction exactly (same cookie name/
// options) - POST /v1/signup returns the identical {token, user} shape as
// /v1/auth/login (see api/src/signup/signup.service.ts), so a successful
// signup logs the new tenant straight into their own dashboard, no separate
// login step.
export async function signupAction(formData: FormData) {
  const companyName = String(formData.get('companyName') ?? '');
  const email = String(formData.get('email') ?? '');
  const password = String(formData.get('password') ?? '');

  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}/v1/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ companyName, email, password }),
      cache: 'no-store',
    });
  } catch {
    redirect('/?signupError=unknown');
  }

  if (!res.ok) {
    const errorCode = res.status === 409 ? 'email-taken' : 'unknown';
    redirect(`/?signupError=${errorCode}`);
  }

  const data = await res.json();
  const store = await cookies();
  store.set(SESSION_COOKIE, data.token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 8, // 8h - matches the JWT's own expiry (see api/src/auth/auth.module.ts)
  });

  redirect('/dashboard');
}
