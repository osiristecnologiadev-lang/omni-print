import Link from 'next/link';
import { getPlatformSession } from '@/lib/platform-api';
import { PlatformLogoutButton } from '@/components/PlatformLogoutButton';
import { LogoMark } from '@/components/Logo';

// Deliberately always-dark, never following the viewer's light/dark
// preference like the tenant app does - this is the OmniPrint operator's
// own cross-tenant area, and a permanently distinct chrome (plus the
// "plataforma" pill) is the signal that you're somewhere with far more
// blast radius than a normal tenant login.
export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  const session = await getPlatformSession();

  return (
    <div className="min-h-screen bg-[#0b0d13] text-[#e8eaf0]">
      {session && (
        <header className="border-b border-[#262b38] bg-[#12151d]">
          <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3">
            <Link href="/platform" className="flex items-center gap-2 font-semibold transition-opacity hover:opacity-80">
              <LogoMark />
              OmniPrint
              <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-400">
                plataforma
              </span>
            </Link>
            <nav className="flex items-center gap-4 text-sm text-[#aab0c0]">
              <Link href="/platform/agent-releases" className="transition-colors hover:text-[#e8eaf0]">
                Releases do agente
              </Link>
              <Link href="/platform/agent-fleet" className="transition-colors hover:text-[#e8eaf0]">
                Frota
              </Link>
              <Link href="/platform/audit-log" className="transition-colors hover:text-[#e8eaf0]">
                Log de auditoria
              </Link>
              <PlatformLogoutButton />
            </nav>
          </div>
        </header>
      )}
      {children}
    </div>
  );
}
