'use client';

import { useActionState } from 'react';
import { createEnrollmentCodeAction } from './actions';
import { buttonClasses } from '@/components/Button';

const initialState = { code: null, label: null, error: null };

// Same reasoning as CreateTokenForm.tsx: the raw code only ever exists in
// this one response (only its hash is stored), so it needs to stay on
// screen after submit without a redirect - hence useActionState instead of
// the plain <form action={serverAction}> pattern used everywhere else.
export function CreateEnrollmentCodeForm({ customerId }: { customerId: string }) {
  const [state, formAction, pending] = useActionState(createEnrollmentCodeAction.bind(null, customerId), initialState);

  return (
    <div>
      <form action={formAction} className="flex gap-2">
        <input
          name="label"
          placeholder="Rótulo (opcional, ex: Matriz)"
          className="flex-1 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none transition-colors focus:border-accent"
        />
        <button type="submit" disabled={pending} className={buttonClasses('primary')}>
          {pending ? 'Gerando...' : 'Gerar código'}
        </button>
      </form>

      {state.error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{state.error}</p>}

      {state.code && (
        <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-900/30">
          <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
            Copie agora — este código não será mostrado de novo. Envie para quem for instalar o agente:
            ele vale por 24 horas e só funciona uma vez. O instalador pede só esse código.
          </p>
          <code className="mt-2 block text-lg font-mono tracking-wide text-ink">{state.code}</code>
        </div>
      )}
    </div>
  );
}
