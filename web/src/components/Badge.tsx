export type BadgeTone = 'ok' | 'info' | 'warning' | 'critical' | 'neutral';

// Semantic status color, deliberately separate from the brand accent
// (--color-accent) - a badge says "this is the state," the accent says
// "this is interactive/OmniPrint's," and conflating them would make actual
// status harder to scan for.
const TONE_CLASSES: Record<BadgeTone, string> = {
  ok: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
  info: 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300',
  warning: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  critical: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
  neutral: 'bg-surface-2 text-ink-muted',
};

export function Badge({ tone, className = '', children }: { tone: BadgeTone; className?: string; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ${TONE_CLASSES[tone]} ${className}`}>
      {children}
    </span>
  );
}
