import type { ButtonHTMLAttributes } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md';

const BOXED =
  'inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none';

const SIZE: Record<ButtonSize, string> = {
  sm: 'px-3 py-1.5 text-xs',
  md: 'px-4 py-2 text-sm',
};

// primary/secondary are boxed buttons; ghost/danger are inline text actions
// (a table row's "Revogar", a card's "Cancelar") - no box, so SIZE doesn't
// apply to them. Two different visual jobs, not four points on one scale:
// primary/secondary ask for attention, ghost/danger sit quietly until read.
const VARIANT: Record<ButtonVariant, string> = {
  primary: `${BOXED} bg-ink text-paper hover:opacity-90`,
  secondary: `${BOXED} border border-line bg-surface text-ink hover:bg-surface-2`,
  ghost: 'text-xs font-medium text-ink-muted transition-colors hover:text-accent',
  danger: 'text-xs font-medium text-red-600 transition-colors hover:underline dark:text-red-400',
};

export function buttonClasses(variant: ButtonVariant = 'secondary', size: ButtonSize = 'md'): string {
  if (variant === 'ghost' || variant === 'danger') {
    return VARIANT[variant];
  }
  return `${VARIANT[variant]} ${SIZE[size]}`;
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export function Button({ variant = 'secondary', size = 'md', className = '', ...props }: ButtonProps) {
  return <button className={`${buttonClasses(variant, size)} ${className}`} {...props} />;
}
