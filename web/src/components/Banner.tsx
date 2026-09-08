export type BannerTone = 'success' | 'error' | 'info';

// Consistent success/error/info feedback for a page that just handled a
// Server Action redirect (the app's `?xSaved=1`/`?xError=...` searchParam
// convention) - replaces ~10 copy-pasted inline <p> banners that had
// drifted into two different color systems (tenant app vs. platform admin).
// Server component (no interactivity needed - the page already re-rendered
// because the URL changed).
const TONE_CLASSES: Record<BannerTone, string> = {
  success: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  error: 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  info: 'bg-sky-50 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300',
};

export function Banner({ tone, className = '', children }: { tone: BannerTone; className?: string; children: React.ReactNode }) {
  return <p className={`mb-3 rounded-lg px-3 py-2 text-sm ${TONE_CLASSES[tone]} ${className}`}>{children}</p>;
}

// Same component, styled for the platform-admin area's permanently-dark
// chrome instead of the tenant app's light/dark-aware tokens (see that
// area's own layout for why it doesn't use the design-token system).
const PLATFORM_TONE_CLASSES: Record<BannerTone, string> = {
  success: 'bg-emerald-950 text-emerald-300',
  error: 'bg-red-950 text-red-300',
  info: 'bg-sky-950 text-sky-300',
};

export function PlatformBanner({ tone, className = '', children }: { tone: BannerTone; className?: string; children: React.ReactNode }) {
  return <p className={`mb-3 rounded-lg px-3 py-2 text-sm ${PLATFORM_TONE_CLASSES[tone]} ${className}`}>{children}</p>;
}
