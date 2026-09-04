export function Panel({ className = '', children }: { className?: string; children: React.ReactNode }) {
  return <div className={`rounded-xl border border-line bg-surface p-5 ${className}`}>{children}</div>;
}

// A Panel with its own header row, sized to sit flush with a table/list
// inside it - see the invoices list, contract history, token list.
export function PanelSection({
  title,
  hint,
  className = '',
  children,
}: {
  title: string;
  hint?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={`overflow-hidden rounded-xl border border-line bg-surface ${className}`}>
      <div className="border-b border-line px-5 py-3">
        <h2 className="text-sm font-medium text-ink">{title}</h2>
        {hint && <p className="mt-0.5 text-xs text-ink-faint">{hint}</p>}
      </div>
      {children}
    </section>
  );
}
