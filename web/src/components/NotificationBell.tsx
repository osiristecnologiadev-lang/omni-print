import Link from 'next/link';
import { getUnreadNotificationCount } from '@/lib/api';

// A labeled sidebar nav row (icon + "Notificações" + unread badge), styled
// to match the other rows in the tenant sidebar - not a standalone
// floating-badge icon like a typical top-bar bell, since there's no top bar
// anymore. Clicking goes to the dedicated /notifications screen, which is
// also where the count gets cleared (see that page).
export async function NotificationBell({ className = '' }: { className?: string }) {
  const { count } = await getUnreadNotificationCount();

  return (
    <Link href="/notifications" className={className}>
      <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <path
          d="M10 2.5c-2.3 0-4 1.9-4 4.3v2.1c0 .5-.2 1.2-.5 1.7l-1 1.5c-.5.8 0 1.9.9 2.1 2.9.6 6.3.6 9.2 0 .9-.2 1.4-1.3.9-2.1l-1-1.5c-.3-.5-.5-1.2-.5-1.7V6.8c0-2.4-1.7-4.3-4-4.3Z"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
        <path d="M8 16.2c.3.9 1 1.5 2 1.5s1.7-.6 2-1.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
      <span className="flex-1">Notificações</span>
      {count > 0 && (
        <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white">
          {count > 9 ? '9+' : count}
        </span>
      )}
    </Link>
  );
}
