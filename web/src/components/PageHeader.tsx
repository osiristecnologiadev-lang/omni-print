import Link from 'next/link';

export function PageHeader({
  title,
  subtitle,
  back,
  actions,
}: {
  title: string;
  subtitle?: string;
  back?: { href: string; label: string };
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-8">
      {back && (
        <Link href={back.href} className="text-sm text-ink-muted transition-colors hover:text-accent">
          ← {back.label}
        </Link>
      )}
      <div className={`flex flex-wrap items-start justify-between gap-4 ${back ? 'mt-3' : ''}`}>
        <div>
          <h1 className="text-2xl font-semibold text-balance text-ink">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-ink-muted">{subtitle}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}
