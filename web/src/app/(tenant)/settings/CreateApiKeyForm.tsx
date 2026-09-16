'use client';

import { useActionState } from 'react';
import { createApiKeyAction } from './actions';
import { buttonClasses } from '@/components/Button';

const initialState = { key: null, error: null };

// Same "show the secret exactly once" pattern as customers/[id]/CreateTokenForm.tsx -
// see that file's comment for why useActionState instead of a plain
// <form action={serverAction}> + redirect.
export function CreateApiKeyForm() {
  const [state, formAction, pending] = useActionState(createApiKeyAction, initialState);

  return (
    <div>
      <form action={formAction} className="flex gap-2">
        <input
          name="label"
          placeholder="Rótulo (opcional, ex: BI interno)"
          className="flex-1 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none transition-colors focus:border-accent"
        />
        <button type="submit" disabled={pending} className={buttonClasses('primary')}>
          {pending ? 'Gerando...' : 'Gerar chave'}
        </button>
      </form>

      {state.error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{state.error}</p>}

      {state.key && (
        <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-900/30">
          <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
            Copie agora — esta chave não será mostrada de novo. Use no cabeçalho{' '}
            <code>Authorization: Bearer {'<chave>'}</code> ao chamar a API externa.
          </p>
          <code className="mt-2 block break-all text-sm font-mono tracking-wide text-ink">{state.key}</code>
        </div>
      )}
    </div>
  );
}
