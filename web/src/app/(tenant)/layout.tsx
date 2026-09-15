import Link from "next/link";
import { getSession, getViewerAccess } from "@/lib/api";
import { hasPermission } from "@/lib/permissions";
import { LogoutButton } from "@/components/LogoutButton";
import { Logo } from "@/components/Logo";
import { ThemeToggle } from "@/components/ThemeToggle";
import { NotificationBell } from "@/components/NotificationBell";
import { GlobalSearch } from "@/components/GlobalSearch";

const NAV_ROW =
  "flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink";

function SidebarLink({ href, icon, label }: { href: string; icon: React.ReactNode; label: string }) {
  return (
    <Link href={href} className={NAV_ROW}>
      {icon}
      <span>{label}</span>
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

  const access = await getViewerAccess();
  const isTenantWide = !session.customerId;

  return (
    <div className="flex">
      <aside className="sticky top-0 flex h-screen w-56 shrink-0 flex-col border-r border-line bg-surface px-3 py-4">
        <Link href="/dashboard" className="mb-4 flex items-center gap-2 px-2 transition-opacity hover:opacity-80">
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
            <SidebarLink href="/customers" icon={<CustomersIcon />} label="Clientes" />
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
          {hasPermission(access, 'agent') && (
            <SidebarLink href="/agent-download" icon={<DownloadIcon />} label="Baixar Agente" />
          )}
          {/* Chamados is the one nav item both session types get - a
              customer-scoped user opens/tracks their own tickets here, a
              tenant-wide user sees the full cross-customer queue. */}
          <SidebarLink href="/tickets" icon={<TicketsIcon />} label="Chamados" />
          {hasPermission(access, 'users') && (
            <SidebarLink href="/users" icon={<UsersIcon />} label="Usuários" />
          )}
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
          {hasPermission(access, 'notifications') && <NotificationBell className={NAV_ROW} />}
        </nav>

        <div className="flex flex-col gap-3 border-t border-line pt-3">
          <div className="px-2">
            <ThemeToggle />
          </div>
          <div className="px-2">
            <LogoutButton />
          </div>
        </div>
      </aside>

      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
