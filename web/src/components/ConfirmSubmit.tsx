import { buttonClasses } from './Button';
import { SubmitButton } from './SubmitButton';

// A destructive action in two steps (usability review 2026-11-10: cancelling
// an invoice or revoking an agent - which stops a customer's data collection
// - happened on a single click). The red label only opens a short question
// saying what will happen; the form is submitted by "Sim, ...". Uses
// <details>, never the browser's confirm() dialog. Put it inside the <form>.
export function ConfirmSubmit({
  label,
  question,
  confirmLabel,
  pendingLabel,
  size,
}: {
  label: string;
  question: string;
  confirmLabel: string;
  pendingLabel?: string;
  size?: 'sm' | 'md';
}) {
  return (
    <details className="group relative inline-block">
      <summary className={`${buttonClasses('danger', size)} cursor-pointer list-none [&::-webkit-details-marker]:hidden`}>{label}</summary>
      <div className="absolute right-0 z-20 mt-2 w-72 rounded-lg border border-line bg-surface p-3 text-left shadow-lg">
        <p className="mb-3 text-xs text-ink">{question}</p>
        <SubmitButton variant="danger" size="sm" pendingLabel={pendingLabel}>
          {confirmLabel}
        </SubmitButton>
      </div>
    </details>
  );
}
