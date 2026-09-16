'use server';

import { redirect } from 'next/navigation';

const API_BASE_URL = process.env.API_BASE_URL ?? 'http://localhost:3000';

export async function resetPasswordAction(formData: FormData) {
  const token = String(formData.get('token') ?? '');
  const password = String(formData.get('password') ?? '');
  const confirmPassword = String(formData.get('confirmPassword') ?? '');

  if (password !== confirmPassword) {
    redirect(`/reset-password?token=${encodeURIComponent(token)}&error=mismatch`);
  }

  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}/v1/auth/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, password }),
      cache: 'no-store',
    });
  } catch {
    redirect(`/reset-password?token=${encodeURIComponent(token)}&error=invalid`);
  }

  if (!res.ok) {
    redirect(`/reset-password?token=${encodeURIComponent(token)}&error=invalid`);
  }

  redirect('/login?reset=1');
}
