export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-line px-8 py-14 text-center">
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" className="text-ink-faint" aria-hidden="true">
        <rect x="5" y="3" width="14" height="6" rx="1" stroke="currentColor" strokeWidth="1.5" />
        <rect x="3" y="9" width="18" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
        <rect x="6.5" y="14.5" width="11" height="7" rx="0.5" stroke="currentColor" strokeWidth="1.5" />
        <circle cx="17.5" cy="12" r="0.9" fill="currentColor" />
      </svg>
      <p className="text-sm font-medium text-ink">{title}</p>
      {hint && <p className="max-w-xs text-xs text-ink-faint">{hint}</p>}
    </div>
  );
}
