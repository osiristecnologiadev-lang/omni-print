'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { PLATFORM_SESSION_COOKIE } from '@/lib/platform-api';

const API_BASE_URL = process.env.API_BASE_URL ?? 'http://localhost:3000';

export async function platformLoginAction(formData: FormData) {
  const email = String(formData.get('email') ?? '');
  const password = String(formData.get('password') ?? '');

  const res = await fetch(`${API_BASE_URL}/v1/platform/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
    cache: 'no-store',
  });

  if (!res.ok) {
    redirect('/platform/login?error=1');
  }

  const data = await res.json();
  const store = await cookies();
  store.set(PLATFORM_SESSION_COOKIE, data.token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 8, // 8h - matches the JWT's own expiry (see api/src/auth/auth.module.ts, shared globally)
  });

  redirect('/platform');
}

export async function platformLogoutAction() {
  const store = await cookies();
  store.delete(PLATFORM_SESSION_COOKIE);
  redirect('/platform/login');
}
