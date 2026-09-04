import Link from "next/link";
import { getSession } from "@/lib/api";
import { LogoutButton } from "@/components/LogoutButton";
import { Logo } from "@/components/Logo";
import { ThemeToggle } from "@/components/ThemeToggle";
import { NotificationBell } from "@/components/NotificationBell";

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

  return (
    <div className="flex">
      <aside className="sticky top-0 flex h-screen w-56 shrink-0 flex-col border-r border-line bg-surface px-3 py-4">
        <Link href="/dashboard" className="mb-6 flex items-center gap-2 px-2 transition-opacity hover:opacity-80">
          <Logo />
        </Link>

        <nav className="flex flex-1 flex-col gap-1">
          {!session.customerId && (
            <>
              <SidebarLink href="/customers" icon={<CustomersIcon />} label="Clientes" />
              <SidebarLink href="/reports" icon={<ReportsIcon />} label="Relatórios" />
              <SidebarLink href="/agent-download" icon={<DownloadIcon />} label="Baixar Agente" />
            </>
          )}
          {/* Chamados is the one nav item both session types get - a
              customer-scoped user opens/tracks their own tickets here, a
              tenant-wide user sees the full cross-customer queue. */}
          <SidebarLink href="/tickets" icon={<TicketsIcon />} label="Chamados" />
          {!session.customerId && (
            <>
              <SidebarLink href="/users" icon={<UsersIcon />} label="Usuários" />
              <SidebarLink href="/settings" icon={<BuildingIcon />} label="Empresa" />
              <NotificationBell className={NAV_ROW} />
            </>
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
      </aside>

      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
