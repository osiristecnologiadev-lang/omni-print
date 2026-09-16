// Server-only, parallel to lib/api.ts but deliberately not sharing any code
// with it: this talks to a completely separate auth system
// (PlatformAuthGuard on the backend, not UserAuthGuard) and a separate
// session cookie, so there's no path by which a bug here could confuse a
// tenant session for a platform one or vice versa.
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

const API_BASE_URL = process.env.API_BASE_URL ?? 'http://localhost:3000';
export const PLATFORM_SESSION_COOKIE = 'omniprint_platform_session';

export type SubscriptionStatusValue = 'TRIALING' | 'ACTIVE' | 'PAST_DUE' | 'CANCELED';

export interface Tenant {
  id: string;
  name: string;
  createdAt: string;
  _count?: { customers: number; devices: number; users: number };
  // OmniPrint's own billing of this tenant - see api's SubscriptionGuard.
  subscriptionStatus: SubscriptionStatusValue;
  trialEndsAt: string;
  // Computed server-side (device count * effective price), not read from
  // Stripe live - see PlatformService.listTenants.
  mrrCents: number;
  // Negotiated per-device rate in cents, or null for the standard rate -
  // see api's Tenant.pricePerDeviceCentsOverride.
  pricePerDeviceCentsOverride: number | null;
}

export interface TenantUser {
  id: string;
  email: string;
  name: string | null;
  customerId: string | null;
  customer: { id: string; name: string } | null;
  createdAt: string;
  revokedAt: string | null;
}

async function getToken(): Promise<string | undefined> {
  const store = await cookies();
  return store.get(PLATFORM_SESSION_COOKIE)?.value;
}

async function authHeaders(): Promise<HeadersInit> {
  const token = await getToken();
  if (!token) {
    redirect('/platform/login');
  }
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

async function apiFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, { headers: await authHeaders(), cache: 'no-store' });
  if (res.status === 401) {
    redirect('/platform/login');
  }
  if (!res.ok) {
    throw new Error(`Platform API request to ${path} failed: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

async function apiMutate<T>(path: string, method: 'POST' | 'PATCH', body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers: await authHeaders(),
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  if (res.status === 401) {
    redirect('/platform/login');
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Platform API ${method} ${path} failed: ${res.status} ${text}`);
  }
  return res.json();
}

// Separate from apiMutate: a FormData body (agent release file upload)
// needs fetch to set its own multipart boundary in Content-Type - sending
// the JSON header from authHeaders() alongside it would break the upload.
async function apiSendForm<T>(path: string, method: 'POST', form: FormData): Promise<T> {
  const token = await getToken();
  if (!token) {
    redirect('/platform/login');
  }
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}` },
    body: form,
    cache: 'no-store',
  });
  if (res.status === 401) {
    redirect('/platform/login');
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Platform API ${method} ${path} failed: ${res.status} ${text}`);
  }
  return res.json();
}

async function apiDelete(path: string): Promise<void> {
  const res = await fetch(`${API_BASE_URL}${path}`, { method: 'DELETE', headers: await authHeaders(), cache: 'no-store' });
  if (res.status === 401) {
    redirect('/platform/login');
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Platform API DELETE ${path} failed: ${res.status} ${text}`);
  }
}

export function getTenants(): Promise<Tenant[]> {
  return apiFetch<Tenant[]>('/v1/platform/tenants');
}

export function getTenant(tenantId: string): Promise<Tenant> {
  return apiFetch<Tenant>(`/v1/platform/tenants/${tenantId}`);
}

export function createTenant(name: string): Promise<Tenant> {
  return apiMutate<Tenant>('/v1/platform/tenants', 'POST', { name });
}

// pricePerDeviceCentsOverride: null clears it back to the standard rate.
export function updateTenantPricing(tenantId: string, pricePerDeviceCentsOverride: number | null): Promise<Tenant> {
  return apiMutate<Tenant>(`/v1/platform/tenants/${tenantId}/pricing`, 'PATCH', { pricePerDeviceCentsOverride });
}

export function getTenantUsers(tenantId: string): Promise<TenantUser[]> {
  return apiFetch<TenantUser[]>(`/v1/platform/tenants/${tenantId}/users`);
}

export function createTenantUser(
  tenantId: string,
  input: { email: string; password: string; name?: string },
): Promise<TenantUser> {
  return apiMutate<TenantUser>(`/v1/platform/tenants/${tenantId}/users`, 'POST', input);
}

export type AgentPlatform = 'WINDOWS' | 'LINUX';

export interface AgentRelease {
  id: string;
  platform: AgentPlatform;
  version: string;
  sha256: string;
  fileSizeBytes: number;
  mandatory: boolean;
  releaseNotes: string | null;
  createdAt: string;
  installerFileSizeBytes: number | null;
}

export interface AgentFleetEntry {
  id: string;
  label: string | null;
  lastSeenVersion: string | null;
  lastCheckinAt: string | null;
  tenant: { name: string };
  customer: { name: string } | null;
}

export function getAgentReleases(): Promise<AgentRelease[]> {
  return apiFetch<AgentRelease[]>('/v1/platform/agent-releases');
}

export function publishAgentRelease(form: FormData): Promise<AgentRelease> {
  return apiSendForm<AgentRelease>('/v1/platform/agent-releases', 'POST', form);
}

export function deleteAgentRelease(id: string): Promise<void> {
  return apiDelete(`/v1/platform/agent-releases/${id}`);
}

export interface AuditLogEntry {
  id: string;
  actorType: 'USER' | 'PLATFORM_ADMIN';
  actorLabel: string | null;
  action: string;
  targetType: string | null;
  targetLabel: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface AuditLogPage {
  entries: AuditLogEntry[];
  nextCursor: string | null;
}

export interface AuditLogFilters {
  cursor?: string;
  action?: string;
  targetType?: string;
  from?: string;
  to?: string;
}

// Platform-admin-actor entries only (tenant creation, agent release
// publish/delete) - not a cross-tenant view of every USER-actor entry too,
// see api/src/audit-log/audit-log.service.ts's listForPlatformAdmins.
export function getPlatformAuditLog(filters: AuditLogFilters = {}): Promise<AuditLogPage> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value) params.set(key, value);
  }
  const qs = params.toString();
  return apiFetch<AuditLogPage>(`/v1/platform/audit-log${qs ? `?${qs}` : ''}`);
}

export function getAgentFleet(): Promise<AgentFleetEntry[]> {
  return apiFetch<AgentFleetEntry[]>('/v1/platform/agent-fleet');
}

export interface PlatformSession {
  adminId: string;
}

// Same "decode without verifying" caveat as lib/api.ts's getSession - UI
// decisions only, the backend guard is the real boundary.
export async function getPlatformSession(): Promise<PlatformSession | null> {
  const token = await getToken();
  if (!token) return null;
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    return payload.platformAdmin === true ? { adminId: payload.sub } : null;
  } catch {
    return null;
  }
}

// Same reasoning as web/src/lib/api.ts's isAuthenticated - deliberately not
// apiFetch/authHeaders (both redirect('/platform/login') on 401), since
// this backs /platform/login's "already authenticated, skip the form"
// redirect. getPlatformSession()'s decode-only check would still say
// "logged in" for a structurally-valid-but-rejected token (e.g. after a
// JWT_SECRET rotation), which would bounce to /platform and immediately
// 401 back to /platform/login - forever. Backend-verified, so only a
// session the API actually accepts short-circuits past the form.
export async function isPlatformAuthenticated(): Promise<boolean> {
  const token = await getToken();
  if (!token) return false;
  const res = await fetch(`${API_BASE_URL}/v1/platform/tenants`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  return res.ok;
}
