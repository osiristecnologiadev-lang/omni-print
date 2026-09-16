import { fetchTenantLogo } from '@/lib/api';

// Proxies the API's logo image through to the browser - same reasoning as
// the invoice PDF's own proxy route: an <img src> can't carry the httpOnly
// session cookie's bearer token, so this reads it server-side and streams
// the bytes along. 404 (no logo uploaded yet) passes through as-is; the
// settings page only renders <img src="/settings/logo"> when it already
// knows (from Tenant.logoFilePath) that one exists.
export async function GET() {
  const upstream = await fetchTenantLogo();
  return new Response(upstream.body, {
    status: upstream.status,
    headers: { 'Content-Type': upstream.headers.get('content-type') ?? 'application/octet-stream' },
  });
}
