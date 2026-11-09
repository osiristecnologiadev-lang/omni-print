import { GLOSSARY, type GlossaryKey } from '@/lib/glossary';

// A small "?" next to a term that shows what it means on hover or keyboard
// focus (usability pass 2026-11-09: the panel was "adivinhativo"). Pure CSS,
// so it works in server and client components alike. Pass a glossary key
// for the shared definitions, or `text` for a one-off explanation.
// placement="bottom" inside scrolling tables, where a balloon opening
// upwards would be clipped by the table's own overflow container.
export function HelpTip({
  term,
  text,
  className = '',
  placement = 'top',
}: {
  term?: GlossaryKey;
  text?: string;
  className?: string;
  placement?: 'top' | 'bottom';
}) {
  const body = text ?? (term ? GLOSSARY[term] : '');
  if (!body) return null;
  return (
    <span className={`group relative inline-flex align-middle ${className}`}>
      <span
        tabIndex={0}
        role="img"
        aria-label={`Ajuda: ${body}`}
        className="ml-1 inline-flex h-4 w-4 cursor-help items-center justify-center rounded-full border border-line text-[10px] leading-none font-medium text-ink-faint outline-none transition-colors hover:border-accent hover:text-accent focus:border-accent focus:text-accent"
      >
        ?
      </span>
      <span
        role="tooltip"
        className={`pointer-events-none invisible absolute ${placement === 'top' ? 'bottom-full mb-2' : 'top-full mt-2'} left-1/2 z-50 w-64 -translate-x-1/2 rounded-lg border border-line bg-surface px-3 py-2 text-left text-xs leading-relaxed font-normal whitespace-normal text-ink normal-case opacity-0 shadow-lg transition-opacity group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100`}
      >
        {body}
      </span>
    </span>
  );
}
