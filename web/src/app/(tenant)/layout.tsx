import Link from "next/link";
import { getSession, getViewerAccessSafe, getTenantOnboardingStatus } from "@/lib/api";
import { hasPermission } from "@/lib/permissions";
import { LogoutButton } from "@/components/LogoutButton";
import { Logo } from "@/components/Logo";
import { ThemeToggle } from "@/components/ThemeToggle";
import { NotificationBell } from "@/components/NotificationBell";
import { GlobalSearch } from "@/components/GlobalSearch";
import { MobileSidebarShell } from "@/components/MobileSidebarShell";

const NAV_ROW =
  "flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink";

// A plain dot, not a count (there's nothing to count) - signals "setup
// pending here" on a nav item, same amber "warning" tone as Badge's
// `warning` variant. title gives the hover explanation a screen-reader-only
// dot alone wouldn't.
function PendingDot({ title }: { title: string }) {
  return <span title={title} className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />;
}

function SidebarLink({
  href,
  icon,
  label,
  badge,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  badge?: React.ReactNode;
}) {
  return (
    <Link href={href} className={NAV_ROW}>
      {icon}
      <span className="flex-1">{label}</span>
      {badge}
    </Link>
  );
}

function CustomersIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <circle cx="7" cy="6.5" r="2.5" stroke="currentColor" strokeWidth="1.4" />
      <path d="M2.5 16c.6-2.8 2.3-4.3 4.5-4.3s3.9 1.5 4.5 4.3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="14" cy="7" r="2" stroke="currentColor" strokeWidth="1.4" />
      <path d="M12.8 11.9c1.8.2 3 1.5 3.5 3.8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function UsersIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <circle cx="10" cy="6.5" r="3" stroke="currentColor" strokeWidth="1.4" />
      <path d="M3.5 16.5c.8-3.4 2.9-5.2 6.5-5.2s5.7 1.8 6.5 5.2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function BuildingIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <rect x="4" y="3" width="9" height="14" rx="1" stroke="currentColor" strokeWidth="1.4" />
      <path d="M13 8.5h3v8.5h-3M6.5 6.5h1M9.5 6.5h1M6.5 9.5h1M9.5 9.5h1M6.5 12.5h1M9.5 12.5h1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function BillingIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <rect x="2.5" y="5" width="15" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
      <path d="M2.5 8.2h15" stroke="currentColor" strokeWidth="1.4" />
      <path d="M5.5 11.5h3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function AuditLogIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <rect x="4.5" y="2.5" width="11" height="15" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
      <path d="M7 6.5h6M7 9.5h6M7 12.5h3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function LogsIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <rect x="2.5" y="4" width="15" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
      <path d="M5.5 8h9M5.5 11h6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function ReportsIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M3.5 16.5h13" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M5.5 16.5v-5M9.5 16.5V7M13.5 16.5v-8.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M10 3.5v9M6.5 9l3.5 3.5L13.5 9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M3.5 16.5h13" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function DevicesIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <rect x="3" y="3.5" width="14" height="8" rx="1.4" stroke="currentColor" strokeWidth="1.4" />
      <path d="M6 15h8M10 11.5V15" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="13.2" cy="7.3" r="0.9" fill="currentColor" />
    </svg>
  );
}

function TicketsIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M2.5 7.5c1 0 1.8-.8 1.8-1.8s-.8-1.8-1.8-1.8v-.4a1 1 0 0 1 1-1h13a1 1 0 0 1 1 1v.4c-1 0-1.8.8-1.8 1.8s.8 1.8 1.8 1.8v5c-1 0-1.8.8-1.8 1.8s.8 1.8 1.8 1.8v.4a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1v-.4c1 0 1.8-.8 1.8-1.8s-.8-1.8-1.8-1.8v-5Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path d="M8 3.5v13" stroke="currentColor" strokeWidth="1.4" strokeDasharray="1.6 1.6" />
    </svg>
  );
}

export default async function TenantLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();

  if (!session) {
    return <>{children}</>;
  }

  // getViewerAccessSafe, not getViewerAccess - this layout wraps EVERY page
  // under (tenant), including /login itself. getSession() above only
  // decodes the cookie (no signature/expiry check), so it stays truthy for
  // a revoked user or a cookie predating a JWT_SECRET rotation; if this
  // call redirected on 401 the way getViewerAccess does, a request to
  // /login would 401 here and redirect back to /login - forever, with no
  // way to ever reach the form and log in fresh. Falling back to the
  // no-sidebar render (same as a genuinely logged-out visitor) instead
  // lets that request reach /login's own page-level check, which redirects
  // to /dashboard only for a session the backend actually still accepts.
  const access = await getViewerAccessSafe();
  if (!access) {
    return <>{children}</>;
  }
  const isTenantWide = !session.customerId;

  // Only fetched for a session that could actually act on it - a
  // customer-scoped login has no "Clientes"/"Baixar Agente" nav items to
  // badge at all, and neither does a tenant-wide user holding neither
  // permission. Same reasoning the dashboard's own onboarding empty-state
  // already uses (see dashboard/page.tsx's canManageCustomers) - this just
  // extends that signal to the sidebar so it doesn't vanish once the admin
  // navigates away from the dashboard. Two indexed existence checks
  // (TenantService.getOnboardingStatus), not the expensive live-Stripe
  // SubscriptionStatus call, since this runs on every page in this layout.
  const canSeeOnboardingHints = isTenantWide && (hasPermission(access, 'customers') || hasPermission(access, 'agent'));
  const onboarding = canSeeOnboardingHints ? await getTenantOnboardingStatus() : null;

  // Groups the nav into "day-to-day" (Clientes/Dispositivos/Relatórios/
  // Chamados/Notificações - what an operator opens constantly) vs.
  // "administração" (Usuários/Baixar Agente/Log de auditoria/Empresa/
  // Assinatura - configured once, then rarely touched) - closes the UX
  // audit finding that the two were visually indistinguishable in one flat
  // list. showAdminGroup guards the section label/divider so a session
  // with zero admin-group permissions (e.g. every one of them unchecked,
  // or a customer-scoped login) doesn't render an empty, label-only group.
  const showAdminGroup =
    hasPermission(access, 'users') ||
    hasPermission(access, 'agent') ||
    hasPermission(access, 'audit_log') ||
    hasPermission(access, 'settings') ||
    hasPermission(access, 'billing');

  return (
    <div className="lg:flex">
      <MobileSidebarShell>
        {/* Hidden below lg - a phone/narrow viewport already sees the logo
            in MobileSidebarShell's own sticky top bar, so this would
            otherwise render twice once the sidebar is opened as an
            overlay. */}
        <Link href="/dashboard" className="mb-4 hidden items-center gap-2 px-2 transition-opacity hover:opacity-80 lg:flex">
          <Logo />
        </Link>

        {/* Tenant-wide only - a customer-scoped session's own nav is
            already small (own devices/tickets), no cross-entity jump to
            search for. */}
        {isTenantWide && (
          <div className="mb-4">
            <GlobalSearch />
          </div>
        )}

        <nav className="flex flex-1 flex-col gap-1">
          {hasPermission(access, 'customers') && (
            <SidebarLink
              href="/customers"
              icon={<CustomersIcon />}
              label="Clientes"
              badge={onboarding && !onboarding.hasCustomers && <PendingDot title="Cadastre seu primeiro cliente" />}
            />
          )}
          {/* Same "any authenticated session, no dedicated permission gate"
              rule GET /v1/devices itself already applies (unlike the PATCH
              that reassigns one, which needs the 'devices' permission) - a
              customer-scoped user browsing here just sees their own fleet,
              same as the dashboard's own device table already shows them. */}
          <SidebarLink href="/devices" icon={<DevicesIcon />} label="Dispositivos" />
          {hasPermission(access, 'reports') && (
            <SidebarLink href="/reports" icon={<ReportsIcon />} label="Relatórios" />
          )}
          {/* Chamados is the one nav item both session types get - a
              customer-scoped user opens/tracks their own tickets here, a
              tenant-wide user sees the full cross-customer queue. */}
          <SidebarLink href="/tickets" icon={<TicketsIcon />} label="Chamados" />
          {hasPermission(access, 'notifications') && <NotificationBell className={NAV_ROW} />}

          {showAdminGroup && (
            <div className="mt-3 border-t border-line pt-3">
              <p className="px-3 pb-1 text-[11px] font-medium tracking-wide text-ink-faint uppercase">Administração</p>
              {hasPermission(access, 'users') && (
                <SidebarLink href="/users" icon={<UsersIcon />} label="Usuários" />
              )}
              {hasPermission(access, 'agent') && (
                <SidebarLink
                  href="/agent-download"
                  icon={<DownloadIcon />}
                  label="Baixar Agente"
                  badge={
                    onboarding &&
                    onboarding.hasCustomers &&
                    !onboarding.hasDevices && <PendingDot title="Nenhum dispositivo monitorado ainda" />
                  }
                />
              )}
              {hasPermission(access, 'agent') && <SidebarLink href="/logs" icon={<LogsIcon />} label="Logs" />}
              {hasPermission(access, 'audit_log') && (
                <SidebarLink href="/audit-log" icon={<AuditLogIcon />} label="Log de auditoria" />
              )}
              {hasPermission(access, 'settings') && (
                <SidebarLink href="/settings" icon={<BuildingIcon />} label="Empresa" />
              )}
              {/* Its own dedicated permission, deliberately NOT bundled into
                  'settings' - billing (payment method, invoices, cancel) was
                  specifically asked to be restricted to whoever the outsource
                  designates, not everyone who can edit Empresa. The backend
                  rejects a customer-scoped caller on every route here
                  regardless of permissions (see SubscriptionController.
                  requireBillingAccess). Always visible now, not only while
                  blocked - closing the audit finding that once a tenant went
                  ACTIVE there was no way back to manage payment method/
                  invoices/cancellation. */}
              {hasPermission(access, 'billing') && (
                <SidebarLink href="/subscribe" icon={<BillingIcon />} label="Assinatura" />
              )}
            </div>
          )}
        </nav>

        <div className="flex flex-col gap-3 border-t border-line pt-3">
          <div className="px-2">
            <ThemeToggle />
          </div>
          <div className="px-2">
            <LogoutButton />
          </div>
        </div>
      </MobileSidebarShell>

      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
