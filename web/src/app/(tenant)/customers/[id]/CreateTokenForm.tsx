'use client';

import { useActionState } from 'react';
import { createTokenAction } from './actions';
import { buttonClasses } from '@/components/Button';

const initialState = { token: null, label: null, error: null };

// The raw token only ever exists in this one response - it can't be
// retrieved again afterward (only its hash is stored). Needs to stay on
// screen after submit without a redirect, hence useActionState instead of
// the plain <form action={serverAction}> pattern used everywhere else in
// this app (which does redirect, and would lose the value).
export function CreateTokenForm({ customerId }: { customerId: string }) {
  const [state, formAction, pending] = useActionState(createTokenAction.bind(null, customerId), initialState);

  return (
    <div>
      <form action={formAction} className="flex gap-2">
        <input
          name="label"
          placeholder="Rótulo (opcional, ex: Matriz)"
          className="flex-1 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none transition-colors focus:border-accent"
        />
        <button type="submit" disabled={pending} className={buttonClasses('primary')}>
          {pending ? 'Gerando...' : 'Gerar token'}
        </button>
      </form>

      {state.error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{state.error}</p>}

      {state.token && (
        <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-900/30">
          <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
            Copie agora — este código não será mostrado de novo. Cole em <code>agent_token</code> no{' '}
            <code>config.yaml</code> do agente instalado no site deste cliente.
          </p>
          <code className="mt-2 block text-lg font-mono tracking-wide text-ink">{state.token}</code>
        </div>
      )}
    </div>
  );
}
