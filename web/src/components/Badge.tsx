export type BadgeTone = 'ok' | 'info' | 'warning' | 'critical' | 'neutral';

// Semantic status color, deliberately separate from the brand accent
// (--color-accent) - a badge says "this is the state," the accent says
// "this is interactive/OmniPrint's," and conflating them would make actual
// status harder to scan for.
//
// Light-mode text is the darker -900 shade, not -800: at text-xs size, -800
// on a -100 background reads as noticeably softer/blurrier than the ink-on-
// paper body text right next to it (confirmed by a close-up screenshot,
// user-reported as "borrado" - the two have similar contrast ratios on
// paper, but the badge text is desaturated/colored rather than nearly-black,
// which anti-aliases visibly softer at small sizes). Dark mode wasn't
// reported as an issue - light text on a dark tint has enough contrast
// already - so only the light-mode shade changed here.
const TONE_CLASSES: Record<BadgeTone, string> = {
  ok: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-300',
  info: 'bg-sky-100 text-sky-900 dark:bg-sky-900/40 dark:text-sky-300',
  warning: 'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-300',
  critical: 'bg-red-100 text-red-900 dark:bg-red-900/40 dark:text-red-300',
  neutral: 'bg-surface-2 text-ink',
};

export function Badge({ tone, className = '', children }: { tone: BadgeTone; className?: string; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ${TONE_CLASSES[tone]} ${className}`}>
      {children}
    </span>
  );
}
