// Server-only: the session token lives in an httpOnly cookie, never read by
// browser JS. Every call here must run in a Server Component, Server
// Action, or Route Handler - never import this from a 'use client' file.
import { cookies } from 'next/headers';
import { redirect, forbidden } from 'next/navigation';

const API_BASE_URL = process.env.API_BASE_URL ?? 'http://localhost:3000';
export const SESSION_COOKIE = 'omniprint_session';

export interface Supply {
  description: string;
  class?: string;
  type_code?: number;
  unit_code?: number;
  colorant?: string;
  level: number;
  max_level: number;
}

export interface Alert {
  severity: string;
  code?: number;
  description?: string;
}

export interface Customer {
  id: string;
  tenantId: string;
  name: string;
  document: string | null;
  address: string | null;
  createdAt: string;
  _count?: { devices: number };
  // Per-customer SLA override for support tickets, in hours - null means
  // "use the global default for that priority" (see api's common/sla.util.ts).
  slaHoursLow: number | null;
  slaHoursMedium: number | null;
  slaHoursHigh: number | null;
  slaHoursUrgent: number | null;
}

export function updateCustomer(
  customerId: string,
  input: {
    document?: string;
    address?: string;
    slaHoursLow?: number | null;
    slaHoursMedium?: number | null;
    slaHoursHigh?: number | null;
    slaHoursUrgent?: number | null;
  },
): Promise<Customer> {
  return apiMutate<Customer>(`/v1/customers/${customerId}`, 'PATCH', input);
}

export interface Tenant {
  id: string;
  name: string;
  document: string | null;
  address: string | null;
  phone: string | null;
  contactEmail: string | null;
  createdAt: string;
}

export function getTenant(): Promise<Tenant> {
  return apiFetch<Tenant>('/v1/tenant');
}

export function updateTenant(input: {
  name?: string;
  document?: string;
  address?: string;
  phone?: string;
  contactEmail?: string;
}): Promise<Tenant> {
  return apiMutate<Tenant>('/v1/tenant', 'PATCH', input);
}

// OmniPrint's own billing of this tenant (distinct from Contract/Invoice,
// which is this tenant billing ITS OWN customers - see api's
// SubscriptionGuard for the gating this reflects).
export type SubscriptionStatusValue = 'TRIALING' | 'ACTIVE' | 'PAST_DUE' | 'CANCELED';

export interface SubscriptionStatus {
  status: SubscriptionStatusValue;
  trialEndsAt: string;
  deviceCount: number;
  pricePerDeviceCents: number;
  estimatedMonthlyCents: number;
  isBlocked: boolean;
  // A platform admin set a negotiated rate of exactly R$0 - "comp this
  // tenant", never blocked regardless of trial/subscription status. See
  // api's isTenantBlocked.
  isComped: boolean;
}

// Ungated by SubscriptionGuard (see api's SubscriptionController) - this
// is how a blocked tenant finds out why and un-blocks itself, so it must
// stay reachable even when every other endpoint 402s.
export function getSubscriptionStatus(): Promise<SubscriptionStatus> {
  return apiFetch<SubscriptionStatus>('/v1/subscription');
}

// Returns a Stripe-hosted Checkout URL to redirect() to - see
// subscribe/actions.ts.
export function createCheckoutSession(): Promise<{ url: string }> {
  return apiMutate<{ url: string }>('/v1/subscription/checkout', 'POST', {});
}

export interface Notification {
  id: string;
  type: 'OVERDUE_INVOICE' | 'EXPIRING_CONTRACT' | 'CRITICAL_DEVICE_ALERT' | 'LOW_SUPPLY' | 'UNASSIGNED_DEVICE';
  title: string;
  body: string;
  createdAt: string;
  updatedAt: string;
  readAt: string | null;
  resolvedAt: string | null;
}

export function getNotifications(): Promise<Notification[]> {
  return apiFetch<Notification[]>('/v1/notifications');
}

export function getUnreadNotificationCount(): Promise<{ count: number }> {
  return apiFetch<{ count: number }>('/v1/notifications/unread-count');
}

export function markAllNotificationsRead(): Promise<{ ok: boolean }> {
  return apiMutate<{ ok: boolean }>('/v1/notifications/mark-all-read', 'POST', {});
}

export function syncNotificationsNow(): Promise<{ created: number; updated: number; autoResolved: number }> {
  return apiMutate<{ created: number; updated: number; autoResolved: number }>('/v1/notifications/sync', 'POST', {});
}

export function resolveNotification(id: string): Promise<Notification> {
  return apiMutate<Notification>(`/v1/notifications/${id}/resolve`, 'POST', {});
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

export function getAuditLog(filters: AuditLogFilters = {}): Promise<AuditLogPage> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value) params.set(key, value);
  }
  const qs = params.toString();
  return apiFetch<AuditLogPage>(`/v1/audit-log${qs ? `?${qs}` : ''}`);
}

// Snake_case: this shape comes from the backend's raw SQL "latest metric per
// device" query, which bypasses Prisma's camelCase field mapping.
export interface LatestMetric {
  id: string;
  device_id: string;
  collected_at: string;
  online: boolean;
  printer_status: string | null;
  device_status: string | null;
  page_count: string | null; // BigInt, serialized as a string - see api/src/main.ts
  // The device's own "pages actually printed" counter, when it reports one -
  // see Collector.collectMarkerSplit's comment. Prefer displayPageCount()
  // over reading page_count directly wherever a single "how many pages"
  // figure is shown - it can differ a lot from page_count on the same
  // device (page_count also counts non-print engine cycles).
  mono_page_count: string | null;
  color_page_count: string | null;
  error_state: Record<string, boolean> | null;
  alerts: Alert[] | null;
  supplies: Supply[] | null;
}

export interface Device {
  id: string;
  tenantId: string;
  customerId: string | null;
  customer: Customer | null;
  serialNumber: string | null;
  host: string;
  name: string | null;
  printerName: string | null;
  customLabel: string | null;
  // A known page count from before this device was ever polled - see the
  // schema comment on the API's Device model. Both null, or both set.
  manualBaselineDate: string | null;
  manualBaselinePageCount: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  latestMetric: LatestMetric | null;
}

// camelCase: this shape comes straight from the Prisma client.
export interface Metric {
  id: string;
  deviceId: string;
  collectedAt: string;
  online: boolean;
  sysDescr: string | null;
  sysName: string | null;
  sysLocation: string | null;
  sysContact: string | null;
  uptimeTicks: string | null;
  consoleDisplay: string | null;
  printerStatusCode: number | null;
  printerStatus: string | null;
  deviceStatusCode: number | null;
  deviceStatus: string | null;
  errorState: Record<string, boolean> | null;
  pageCount: string | null;
  monoPageCount: string | null;
  colorPageCount: string | null;
  powerOnCount: string | null;
  supplies: Supply[] | null;
  inputTrays: unknown[] | null;
  alerts: Alert[] | null;
  raw: Record<string, string> | null;
  errorMessage: string | null;
}

export async function getSessionToken(): Promise<string | undefined> {
  const store = await cookies();
  return store.get(SESSION_COOKIE)?.value;
}

const TIMEZONE_COOKIE = 'omniprint_tz';

// The viewer's own IANA timezone (e.g. "America/Sao_Paulo"), captured
// client-side once (see layout.tsx's tz-sync script) and sent back on every
// request as a cookie - Server Components render on Railway (UTC), so
// without this every date/time shown would be in UTC regardless of where
// the actual viewer is. Undefined on the very first request ever (before
// the cookie exists) - Intl.DateTimeFormat's own timeZone default (the
// server's) applies for just that one render, every later request has it.
// Pass the result into any Intl.DateTimeFormat call formatting a real
// instant (createdAt, collectedAt, dueDate...) - NOT a calendar-only
// UTC-midnight-anchored value like Invoice.periodStart, which already has
// its own deliberate timeZone: 'UTC' handling (see formatUtcDate in
// dashboard/page.tsx and customers/[id]/page.tsx) for a different reason.
export async function getViewerTimeZone(): Promise<string | undefined> {
  const store = await cookies();
  return store.get(TIMEZONE_COOKIE)?.value || undefined;
}

export interface Session {
  userId: string;
  tenantId: string;
  customerId: string | null;
}

// Decodes the JWT payload WITHOUT verifying its signature - this is only
// ever used for UI decisions (e.g. "show the customer picker to tenant-wide
// users"), never for authorization. Every actual API call still sends the
// raw token, and the backend's UserAuthGuard re-verifies it properly - that
// guard is the real security boundary, not this.
export async function getSession(): Promise<Session | null> {
  const token = await getSessionToken();
  if (!token) return null;
  try {
    const payloadB64 = token.split('.')[1];
    const json = Buffer.from(payloadB64, 'base64url').toString('utf8');
    const payload = JSON.parse(json);
    return { userId: payload.sub, tenantId: payload.tenantId, customerId: payload.customerId ?? null };
  } catch {
    return null;
  }
}

export interface ViewerAccess {
  customerId: string | null;
  permissions: string[];
}

// Unlike getSession() above, this is a real request to GET /v1/users/me,
// not a local JWT decode - permissions are deliberately NOT embedded in the
// token (see UserAuthGuard's comment on why: they're read live from the DB
// on every backend request so editing a user's permissions takes effect
// immediately). Call this wherever a nav or page decision depends on module
// access, not session.customerId alone.
export async function getViewerAccess(): Promise<ViewerAccess> {
  return apiFetch<ViewerAccess>('/v1/users/me');
}

async function authHeaders(): Promise<HeadersInit> {
  const token = await getSessionToken();
  if (!token) {
    redirect('/login');
  }
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

async function apiFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    headers: await authHeaders(),
    cache: 'no-store', // fleet status changes frequently; always fetch fresh
  });
  if (res.status === 401) {
    redirect('/login');
  }
  if (res.status === 403) {
    // A customer-scoped session hitting a tenant-wide-only endpoint (e.g. a
    // stale bookmark to /customers). Pages that know this in advance should
    // still call forbidden() themselves before fetching - this is the
    // fallback for when they don't, not the primary check.
    forbidden();
  }
  if (res.status === 402) {
    // SubscriptionGuard: the tenant's OmniPrint subscription is inactive
    // (trial expired or payment not active) - see /subscribe's own page,
    // which calls /v1/subscription directly (ungated) to explain why.
    redirect('/subscribe');
  }
  if (!res.ok) {
    throw new Error(`API request to ${path} failed: ${res.status} ${res.statusText}`);
  }
  // A controller returning `null` (e.g. "no active contract") produces a
  // genuinely empty 200 body (Content-Length: 0), not the string "null" -
  // res.json() throws (SyntaxError: Unexpected end of JSON input) on an
  // empty body instead of parsing it as null. See getAgentLatestRelease's
  // comment for where this was first confirmed.
  const text = await res.text();
  return text ? JSON.parse(text) : (null as T);
}

async function apiMutate<T>(path: string, method: 'POST' | 'PATCH', body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers: await authHeaders(),
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  if (res.status === 401) {
    redirect('/login');
  }
  if (res.status === 403) {
    forbidden();
  }
  if (res.status === 402) {
    redirect('/subscribe');
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`API ${method} ${path} failed: ${res.status} ${text}`);
  }
  return res.json();
}

export function getDevices(): Promise<Device[]> {
  return apiFetch<Device[]>('/v1/devices');
}

export interface DailyPagePoint {
  date: string;
  pages: number;
}
export interface DailySupplyPoint {
  date: string;
  percent: number | null;
}
export interface ActiveAlert {
  deviceId: string;
  deviceName: string;
  host: string;
  serialNumber: string | null;
  customerId: string | null;
  customerName: string | null;
  // "Pages actually printed" when available, engine/mechanism count
  // otherwise - see displayPageCount(). Already resolved server-side here
  // since ActiveAlert isn't a full LatestMetric.
  pageCount: number | null;
  enginePageCount: string | null; // BigInt, serialized as a string
  severity: string;
  code?: number;
  description?: string;
}

export function getFleetPageTrend(days = 30): Promise<DailyPagePoint[]> {
  return apiFetch<DailyPagePoint[]>(`/v1/devices/trend?days=${days}`);
}

// "How much has been printed since the 1st of this month, right now" - the
// same window/math ContractsService bills off, but doesn't need a billing
// contract to exist (unlike getCurrentPeriodBilling/getPortfolioCurrentPeriod).
export interface DeviceCurrentMonthPages {
  periodStart: string;
  periodEnd: string;
  pages: number;
  monoPages: number;
  colorPages: number;
  startReading: number | null;
  endReading: number | null;
  // When `pages` actually starts/ends counting from - not always
  // periodStart/periodEnd (the manual baseline date, or the device's first
  // real reading if monitoring started mid-period, can push it later or
  // earlier). See enginePages' own dates below for why the two figures
  // often cover different windows and aren't directly comparable.
  startReadingAt: string | null;
  endReadingAt: string | null;
  counterReset: boolean;
  usedManualBaseline: boolean;
  usedFallbackForReset: boolean;
  enginePages: number;
  engineStartReading: number | null;
  engineEndReading: number | null;
  engineStartReadingAt: string | null;
  engineEndReadingAt: string | null;
}

export function getDeviceCurrentMonthPages(deviceId: string): Promise<DeviceCurrentMonthPages> {
  return apiFetch<DeviceCurrentMonthPages>(`/v1/devices/${deviceId}/current-month-pages`);
}

export interface FleetCurrentMonthPages {
  periodStart: string;
  periodEnd: string;
  totalPages: number;
  deviceCount: number;
}

export function getFleetCurrentMonthPages(): Promise<FleetCurrentMonthPages> {
  return apiFetch<FleetCurrentMonthPages>('/v1/devices/current-month-pages');
}

export function getActiveAlerts(): Promise<ActiveAlert[]> {
  return apiFetch<ActiveAlert[]>('/v1/alerts');
}

export function getDevicePageTrend(deviceId: string, days = 30): Promise<DailyPagePoint[]> {
  return apiFetch<DailyPagePoint[]>(`/v1/devices/${deviceId}/page-trend?days=${days}`);
}

export function getDeviceSupplyTrend(deviceId: string, days = 30): Promise<DailySupplyPoint[]> {
  return apiFetch<DailySupplyPoint[]>(`/v1/devices/${deviceId}/supply-trend?days=${days}`);
}

export interface UsageRevenueMonth {
  month: string; // ISO date, always the 1st of the month
  totalDue: number;
  paidAmount: number;
  totalPages: number;
}

export interface UsageRevenueByCustomer {
  customerId: string;
  customerName: string;
  totalDue: number;
  paidAmount: number;
  outstanding: number;
  totalPages: number;
  invoiceCount: number;
}

export interface UsageRevenueReport {
  months: number;
  windowStart: string;
  totalRevenue: number;
  totalPaid: number;
  totalOutstanding: number;
  totalPages: number;
  monthly: UsageRevenueMonth[];
  byCustomer: UsageRevenueByCustomer[];
}

export function getUsageRevenueReport(months = 12): Promise<UsageRevenueReport> {
  return apiFetch<UsageRevenueReport>(`/v1/reports/usage-revenue?months=${months}`);
}

export interface SupplyForecast {
  description: string;
  colorant: string | null;
  currentPercent: number;
  dailyConsumptionPercent: number | null;
  daysRemaining: number | null;
  estimatedEmptyDate: string | null;
  likelyEmptyAlready: boolean;
  replacement: { leftoverPercent: number; at: string } | null;
  premature: boolean;
}

export interface LowSupplyForecast {
  deviceId: string;
  deviceName: string;
  customerId: string | null;
  description: string;
  colorant: string | null;
  currentPercent: number;
  dailyConsumptionPercent: number | null;
  daysRemaining: number | null;
  estimatedEmptyDate: string | null;
  likelyEmptyAlready: boolean;
  premature: boolean;
  leftoverPercent: number | null;
  replacedAt: string | null;
}

export function getDeviceSupplyForecast(deviceId: string, lookback = 90): Promise<SupplyForecast[]> {
  return apiFetch<SupplyForecast[]>(`/v1/devices/${deviceId}/supply-forecast?lookback=${lookback}`);
}

export function getLowSupplyForecast(days = 14, lookback = 90): Promise<LowSupplyForecast[]> {
  return apiFetch<LowSupplyForecast[]>(`/v1/devices/supply-forecast?days=${days}&lookback=${lookback}`);
}

export function getDeviceMetrics(deviceId: string, limit = 50): Promise<Metric[]> {
  return apiFetch<Metric[]>(`/v1/devices/${deviceId}/metrics?limit=${limit}`);
}

// No single-device endpoint on the backend yet - fine at current fleet
// sizes, but worth a dedicated GET /v1/devices/:id if this list ever grows
// large enough for this to matter.
export async function getDevice(deviceId: string): Promise<Device | undefined> {
  const devices = await getDevices();
  return devices.find((d) => d.id === deviceId);
}

export interface AgentTokenSummary {
  id: string;
  label: string | null;
  createdAt: string;
  revokedAt: string | null;
  lastCheckinAt: string | null;
  lastSeenVersion: string | null;
}

export interface CreatedAgentToken {
  id: string;
  label: string | null;
  createdAt: string;
  token: string; // raw value - only ever present in this one response
}

export function getCustomers(): Promise<Customer[]> {
  return apiFetch<Customer[]>('/v1/customers');
}

export function getCustomer(customerId: string): Promise<Customer> {
  return apiFetch<Customer>(`/v1/customers/${customerId}`);
}

export function createCustomer(name: string): Promise<Customer> {
  return apiMutate<Customer>('/v1/customers', 'POST', { name });
}

export function getCustomerTokens(customerId: string): Promise<AgentTokenSummary[]> {
  return apiFetch<AgentTokenSummary[]>(`/v1/customers/${customerId}/agent-tokens`);
}

export interface DashboardUser {
  id: string;
  email: string;
  name: string | null;
  customerId: string | null;
  customer: { id: string; name: string } | null;
  permissions: string[];
  createdAt: string;
  revokedAt: string | null;
}

export function getUsers(): Promise<DashboardUser[]> {
  return apiFetch<DashboardUser[]>('/v1/users');
}

export function createUser(input: {
  email: string;
  password: string;
  name?: string;
  customerId?: string | null;
  permissions?: string[];
}): Promise<DashboardUser> {
  return apiMutate<DashboardUser>('/v1/users', 'POST', input);
}

export function revokeUser(userId: string): Promise<DashboardUser> {
  return apiMutate<DashboardUser>(`/v1/users/${userId}/revoke`, 'POST', {});
}

export function updateUserPermissions(userId: string, permissions: string[]): Promise<DashboardUser> {
  return apiMutate<DashboardUser>(`/v1/users/${userId}/permissions`, 'PATCH', { permissions });
}

export function createCustomerToken(customerId: string, label?: string): Promise<CreatedAgentToken> {
  return apiMutate<CreatedAgentToken>(`/v1/customers/${customerId}/agent-tokens`, 'POST', { label });
}

export function revokeCustomerToken(customerId: string, tokenId: string): Promise<AgentTokenSummary> {
  return apiMutate<AgentTokenSummary>(`/v1/customers/${customerId}/agent-tokens/${tokenId}/revoke`, 'POST', {});
}

export interface AgentEnrollmentCodeSummary {
  id: string;
  label: string | null;
  createdAt: string;
  expiresAt: string;
  usedAt: string | null;
  revokedAt: string | null;
  agentTokenId: string | null;
}

export interface CreatedAgentEnrollmentCode {
  id: string;
  label: string | null;
  createdAt: string;
  expiresAt: string;
  code: string; // raw value - only ever present in this one response
}

export function getCustomerEnrollmentCodes(customerId: string): Promise<AgentEnrollmentCodeSummary[]> {
  return apiFetch<AgentEnrollmentCodeSummary[]>(`/v1/customers/${customerId}/agent-enrollment-codes`);
}

export function createCustomerEnrollmentCode(customerId: string, label?: string): Promise<CreatedAgentEnrollmentCode> {
  return apiMutate<CreatedAgentEnrollmentCode>(`/v1/customers/${customerId}/agent-enrollment-codes`, 'POST', { label });
}

export function revokeCustomerEnrollmentCode(customerId: string, codeId: string): Promise<AgentEnrollmentCodeSummary> {
  return apiMutate<AgentEnrollmentCodeSummary>(
    `/v1/customers/${customerId}/agent-enrollment-codes/${codeId}/revoke`,
    'POST',
    {},
  );
}

export function assignDeviceCustomer(deviceId: string, customerId: string | null): Promise<Device> {
  return apiMutate<Device>(`/v1/devices/${deviceId}`, 'PATCH', { customerId });
}

export function updateDeviceLabel(deviceId: string, customLabel: string | null): Promise<Device> {
  return apiMutate<Device>(`/v1/devices/${deviceId}`, 'PATCH', { customLabel });
}

// Both null clears it back to "no baseline" - see Device.manualBaselineDate.
export function updateDeviceManualBaseline(
  deviceId: string,
  manualBaselineDate: string | null,
  manualBaselinePageCount: number | null,
): Promise<Device> {
  return apiMutate<Device>(`/v1/devices/${deviceId}`, 'PATCH', { manualBaselineDate, manualBaselinePageCount });
}

export type ContractStatus = 'ACTIVE' | 'SUSPENDED' | 'CANCELLED' | 'EXPIRED';

// Which outsourcing tenants use which model varies - see api's Contract
// schema comment for the full reasoning:
//   FLAT_RATE:              fixedFee only, page count doesn't affect price.
//   ALLOWANCE_PLUS_OVERAGE: fixedFee bundles included pages for free; pages
//                           beyond that cost overagePrice each.
//   PER_PAGE:               every billable page costs pricePerPage, but
//                           never fewer than minimumPages are billed even
//                           if the customer printed less.
export type ContractPricingModel = 'FLAT_RATE' | 'ALLOWANCE_PLUS_OVERAGE' | 'PER_PAGE';

export interface Contract {
  id: string;
  customerId: string;
  status: ContractStatus;
  pricingModel: ContractPricingModel;
  startDate: string;
  endDate: string | null;
  billingDay: number;
  // Decimal fields serialize as strings - see api/src/main.ts's note on
  // BigInt for the same reason. Nullable because which ones apply depends
  // on pricingModel.
  fixedFee: string | null;
  includedPagesMono: number | null;
  includedPagesColor: number | null;
  overagePriceMono: string | null;
  overagePriceColor: string | null;
  pricePerPageMono: string | null;
  pricePerPageColor: string | null;
  minimumPagesMono: number | null;
  minimumPagesColor: number | null;
  setupFee: string | null;
  earlyTerminationFee: string | null;
  adjustmentIndex: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateContractInput {
  pricingModel: ContractPricingModel;
  startDate: string;
  endDate?: string;
  billingDay: number;
  fixedFee?: number;
  includedPagesMono?: number;
  includedPagesColor?: number;
  overagePriceMono?: number;
  overagePriceColor?: number;
  pricePerPageMono?: number;
  pricePerPageColor?: number;
  minimumPagesMono?: number;
  minimumPagesColor?: number;
  setupFee?: number;
  earlyTerminationFee?: number;
  adjustmentIndex?: string;
  notes?: string;
}

export interface DevicePages {
  deviceId: string;
  deviceName: string;
  serialNumber: string | null;
  host: string;
  pages: number;
  monoPages: number;
  colorPages: number;
  startReading: number | null;
  endReading: number | null;
  counterReset: boolean;
  usedManualBaseline: boolean;
  usedFallbackForReset: boolean;
  enginePages: number;
  engineStartReading: number | null;
  engineEndReading: number | null;
  // Estimated share of the contract's usage revenue this device is
  // responsible for, proportional to its own mono/color page share - not a
  // literal per-device bill (none of the pricing models actually bill per
  // printer). Always 0 under FLAT_RATE, since that fee isn't usage-based at
  // all. See api's allocateUsageRevenue for the full reasoning.
  usageRevenue: number;
}

export type BillingResult =
  | { hasContract: false; periodStart: string; periodEnd: string }
  | {
      hasContract: true;
      periodStart: string;
      periodEnd: string;
      contract: Contract;
      perDevice: DevicePages[];
      totalPages: number;
      monoPages: number;
      colorPages: number;
      fixedFee: number;
      includedTotal: number | null;
      overagePages: number | null;
      minimumPages: number | null;
      billablePages: number | null;
      usageCost: number;
      totalDue: number;
    };

export function getContracts(customerId: string): Promise<Contract[]> {
  return apiFetch<Contract[]>(`/v1/customers/${customerId}/contracts`);
}

export function getActiveContract(customerId: string): Promise<Contract | null> {
  return apiFetch<Contract | null>(`/v1/customers/${customerId}/contracts/active`);
}

export function createContract(customerId: string, input: CreateContractInput): Promise<Contract> {
  return apiMutate<Contract>(`/v1/customers/${customerId}/contracts`, 'POST', input);
}

export function updateContract(
  customerId: string,
  contractId: string,
  input: Partial<CreateContractInput>,
): Promise<Contract> {
  return apiMutate<Contract>(`/v1/customers/${customerId}/contracts/${contractId}`, 'PATCH', input);
}

export function cancelContract(customerId: string, contractId: string): Promise<Contract> {
  return apiMutate<Contract>(`/v1/customers/${customerId}/contracts/${contractId}/cancel`, 'POST', {});
}

export function getBilling(customerId: string, year: number, month: number): Promise<BillingResult> {
  return apiFetch<BillingResult>(`/v1/customers/${customerId}/contracts/billing?year=${year}&month=${month}`);
}

// "Guaranteed so far this month" - the still-open current period, not a
// closed/past one like getBilling above.
export function getCurrentPeriodBilling(customerId: string): Promise<BillingResult> {
  return apiFetch<BillingResult>(`/v1/customers/${customerId}/contracts/billing/current`);
}

export interface PortfolioCurrentPeriod {
  periodStart: string;
  periodEnd: string;
  totalAccrued: number;
  byCustomer: Array<{ customerId: string; customerName: string; totalDue: number; totalPages: number }>;
}

export function getPortfolioCurrentPeriod(): Promise<PortfolioCurrentPeriod> {
  return apiFetch<PortfolioCurrentPeriod>('/v1/reports/current-period');
}

export type InvoiceStatus = 'PENDING' | 'PAID' | 'CANCELLED';

export interface InvoicePerDevice {
  deviceId: string;
  deviceName: string;
  serialNumber: string | null;
  host: string;
  pages: number;
  monoPages: number;
  colorPages: number;
  startReading: number | null;
  endReading: number | null;
  counterReset: boolean;
  usedManualBaseline?: boolean;
  usedFallbackForReset?: boolean;
  enginePages?: number;
  engineStartReading?: number | null;
  engineEndReading?: number | null;
}

export interface Invoice {
  id: string;
  number: number;
  customerId: string;
  contractId: string;
  periodStart: string;
  periodEnd: string;
  dueDate: string;
  status: InvoiceStatus;
  pricingModel: ContractPricingModel;
  totalPages: number;
  monoPages: number | null;
  colorPages: number | null;
  perDevice: InvoicePerDevice[];
  fixedFee: string;
  usageCost: string;
  totalDue: string;
  paidAt: string | null;
  paidAmount: string | null;
  generatedAt: string;
  createdAt: string;
  updatedAt: string;
}

export function getInvoices(customerId: string): Promise<Invoice[]> {
  return apiFetch<Invoice[]>(`/v1/customers/${customerId}/invoices`);
}

export function getInvoice(customerId: string, invoiceId: string): Promise<Invoice> {
  return apiFetch<Invoice>(`/v1/customers/${customerId}/invoices/${invoiceId}`);
}

export function generateInvoice(customerId: string, year: number, month: number): Promise<Invoice> {
  return apiMutate<Invoice>(`/v1/customers/${customerId}/invoices/generate`, 'POST', { year, month });
}

export function markInvoicePaid(customerId: string, invoiceId: string, paidAmount?: number): Promise<Invoice> {
  return apiMutate<Invoice>(`/v1/customers/${customerId}/invoices/${invoiceId}/pay`, 'POST', { paidAmount });
}

export function cancelInvoice(customerId: string, invoiceId: string): Promise<Invoice> {
  return apiMutate<Invoice>(`/v1/customers/${customerId}/invoices/${invoiceId}/cancel`, 'POST', {});
}

export interface ContractWithCustomer extends Contract {
  customer: Customer;
}
export interface InvoiceWithCustomer extends Invoice {
  customer: Customer;
}

export interface BillingAlerts {
  expiringContracts: ContractWithCustomer[];
  overdueInvoices: InvoiceWithCustomer[];
}

export function getBillingAlerts(): Promise<BillingAlerts> {
  return apiFetch<BillingAlerts>('/v1/billing-alerts');
}

// Streams the PDF straight from the API - used only by the /invoices/[id]/pdf
// route handler (a browser <a> tag can't send the httpOnly session cookie's
// bearer token itself, so that route proxies this through server-side).
export async function fetchInvoicePdf(customerId: string, invoiceId: string): Promise<Response> {
  const res = await fetch(`${API_BASE_URL}/v1/customers/${customerId}/invoices/${invoiceId}/pdf`, {
    headers: await authHeaders(),
    cache: 'no-store',
  });
  if (res.status === 401) {
    redirect('/login');
  }
  if (res.status === 403) {
    forbidden();
  }
  if (!res.ok) {
    throw new Error(`API GET invoice pdf failed: ${res.status}`);
  }
  return res;
}

export interface AgentLatestRelease {
  id: string;
  version: string;
  releaseNotes: string | null;
  hasInstaller: boolean;
  installerSizeBytes: number | null;
}

// v1/agent-download/* (api/src/agent-releases/agent-download.controller.ts) -
// a logged-in tenant user downloading the installer for a first install.
// Distinct from the agent's own auto-update endpoints (v1/agent/releases/*),
// which use an agent token, not a dashboard session.
// Not apiFetch: when no release exists yet, the API sends a genuinely empty
// 200 body for a `null` return (confirmed - not a bug, agent/internal/updater's
// Go client has the exact same `len(body) == 0` check for this), and
// res.json() throws on an empty body instead of parsing it as null.
export async function getAgentLatestRelease(platform: 'WINDOWS' | 'LINUX'): Promise<AgentLatestRelease | null> {
  const res = await fetch(`${API_BASE_URL}/v1/agent-download/latest?platform=${platform}`, {
    headers: await authHeaders(),
    cache: 'no-store',
  });
  if (res.status === 401) {
    redirect('/login');
  }
  if (res.status === 403) {
    forbidden();
  }
  if (!res.ok) {
    throw new Error(`API GET agent-download latest failed: ${res.status}`);
  }
  const text = await res.text();
  if (!text) {
    return null;
  }
  return JSON.parse(text);
}

// Same proxy-through-server-side-auth reasoning as fetchInvoicePdf above -
// used only by the agent-download installer route handler.
export async function fetchAgentInstaller(releaseId: string): Promise<Response> {
  const res = await fetch(`${API_BASE_URL}/v1/agent-download/${releaseId}/installer`, {
    headers: await authHeaders(),
    cache: 'no-store',
  });
  if (res.status === 401) {
    redirect('/login');
  }
  if (res.status === 403) {
    forbidden();
  }
  if (!res.ok) {
    throw new Error(`API GET agent installer failed: ${res.status}`);
  }
  return res;
}

// Lowest fill level among actual consumables (class "supply" - toner/ink;
// excludes "other" class items like roller-life counters, which aren't
// something a fleet manager restocks).
export function lowestSupplyPercent(metric: LatestMetric | Metric | null): number | null {
  if (!metric?.supplies) return null;
  const percents = metric.supplies
    .filter((s) => s.class === 'supply' && s.max_level > 0)
    .map((s) => (s.level / s.max_level) * 100);
  return percents.length > 0 ? Math.min(...percents) : null;
}

// displayPageCount/engineDisplayPageCount moved to lib/pages.ts - that
// module has no next/headers import, so client components (DeviceFleetTable's
// search UI) can use them without pulling this whole server-only module into
// the client bundle.

export type TicketStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED';
export type TicketPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';

interface TicketPerson {
  id: string;
  name: string | null;
  email: string;
}

export interface TicketComment {
  id: string;
  ticketId: string;
  body: string;
  createdAt: string;
  authorUser: TicketPerson;
}

export interface Ticket {
  id: string;
  customerId: string;
  deviceId: string | null;
  subject: string;
  description: string;
  status: TicketStatus;
  priority: TicketPriority;
  slaDueAt: string;
  resolvedAt: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
  customer: { id: string; name: string };
  device: { id: string; name: string | null; printerName: string | null; customLabel: string | null; host: string } | null;
  createdByUser: TicketPerson;
  assignedToUser: TicketPerson | null;
  comments?: TicketComment[];
}

// Both sides use this: a customer-scoped session only ever sees its own
// customerId anyway (see TicketsController on the backend), so the same
// call works whether the caller is staff or the customer who owns them.
export function getCustomerTickets(customerId: string, status?: TicketStatus): Promise<Ticket[]> {
  return apiFetch<Ticket[]>(`/v1/customers/${customerId}/tickets${status ? `?status=${status}` : ''}`);
}

export function getTicket(customerId: string, ticketId: string): Promise<Ticket> {
  return apiFetch<Ticket>(`/v1/customers/${customerId}/tickets/${ticketId}`);
}

export function createTicket(
  customerId: string,
  input: { subject: string; description: string; priority?: TicketPriority; deviceId?: string },
): Promise<Ticket> {
  return apiMutate<Ticket>(`/v1/customers/${customerId}/tickets`, 'POST', input);
}

export function addTicketComment(customerId: string, ticketId: string, body: string): Promise<TicketComment> {
  return apiMutate<TicketComment>(`/v1/customers/${customerId}/tickets/${ticketId}/comments`, 'POST', { body });
}

// Tenant-wide only - the staff queue across every customer at once.
export function getAllTickets(status?: TicketStatus): Promise<Ticket[]> {
  return apiFetch<Ticket[]>(`/v1/tickets${status ? `?status=${status}` : ''}`);
}

// Tenant-wide only - fetches one ticket without needing to know its
// customerId ahead of time (unlike getTicket, which is customer-scoped by
// path) - what the flat /tickets/:id detail page uses for a staff session.
export function getAnyTicket(ticketId: string): Promise<Ticket> {
  return apiFetch<Ticket>(`/v1/tickets/${ticketId}`);
}

// Tenant-wide only - status/priority/assignment. Pass assignedToUserId:
// null to unassign.
export function updateTicket(
  ticketId: string,
  input: { status?: TicketStatus; priority?: TicketPriority; assignedToUserId?: string | null },
): Promise<Ticket> {
  return apiMutate<Ticket>(`/v1/tickets/${ticketId}`, 'PATCH', input);
}
