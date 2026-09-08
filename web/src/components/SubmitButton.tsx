'use client';

import { useFormStatus } from 'react-dom';
import { Button, type ButtonVariant, type ButtonSize } from './Button';

// A form's submit button, showing a pending state (disabled + optional
// label swap) while its own <form> is submitting - useFormStatus only
// reads the nearest parent <form>, so this only needs to be a client
// component itself, not the whole form/page around it. Drop-in
// replacement for `<Button type="submit">` on any Server Action form in
// this app (which is almost every form here - see the app's "minimal
// client JS" convention).
interface SubmitButtonProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  children: React.ReactNode;
  pendingLabel?: string;
}

export function SubmitButton({ variant, size, className, children, pendingLabel }: SubmitButtonProps) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} size={size} className={className} disabled={pending}>
      {pending && pendingLabel ? pendingLabel : children}
    </Button>
  );
}

// Same pending-state logic as SubmitButton, but a bare <button> taking a
// full className instead of going through Button's variant system - for
// the platform-admin area, which deliberately hand-rolls its own always-
// dark Tailwind classes rather than the tenant app's light/dark-aware
// design tokens (see that area's own layout for why).
export function PlainSubmitButton({
  className = '',
  children,
  pendingLabel,
}: {
  className?: string;
  children: React.ReactNode;
  pendingLabel?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={`disabled:opacity-50 disabled:pointer-events-none ${className}`}>
      {pending && pendingLabel ? pendingLabel : children}
    </button>
  );
}
