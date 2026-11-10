import { headers } from 'next/headers';

// The panel calls the API from its own server, so without this the API saw
// every panel user as ONE client (the web container's address) - all of
// them sharing a single rate-limit bucket: a few people browsing at once
// got 429 -> "Algo deu errado", and a few wrong passwords anywhere locked
// everyone out of login for a minute (found by the E2E tests, 2026-11-09).
// Caddy puts the visitor's address in X-Forwarded-For; pass it on so the
// API (TRUST_PROXY=1) limits each visitor separately.
export async function forwardedForHeader(): Promise<Record<string, string>> {
  try {
    const h = await headers();
    const ip = (h.get('x-forwarded-for')?.split(',')[0] ?? h.get('x-real-ip') ?? '').trim();
    // Only a plain IPv4/IPv6 address - never echo anything else into a header.
    return /^[0-9a-fA-F:.]{3,45}$/.test(ip) ? { 'X-Forwarded-For': ip } : {};
  } catch {
    return {}; // outside a request (build time, instrumentation)
  }
}
