'use client';

import { useActionState } from 'react';
import { updateDiscoveryRangesAction, type DiscoveryRangesState } from './actions';
import { buttonClasses } from '@/components/Button';
import { Banner } from '@/components/Banner';

// useActionState rather than the redirect-with-?xError=1 pattern: the API's
// message names exactly which line is wrong ("Faixa grande demais:
// 10.0.0.0/8"), and the textarea keeps what was typed so it can be fixed in
// place instead of retyped.
export function DiscoveryRangesForm({ customerId, ranges }: { customerId: string; ranges: string[] }) {
  const initialState: DiscoveryRangesState = { text: ranges.join('\n'), error: null, saved: false };
  const [state, formAction, pending] = useActionState(updateDiscoveryRangesAction.bind(null, customerId), initialState);

  return (
    <form action={formAction}>
      {state.saved && (
        <Banner tone="success">
          Redes salvas. Os agentes usam na próxima busca - para buscar já, use &ldquo;Buscar impressoras agora&rdquo;
          no agente abaixo.
        </Banner>
      )}
      {state.error && <Banner tone="error">{state.error}</Banner>}
      <textarea
        key={state.text}
        name="ranges"
        rows={4}
        defaultValue={state.text}
        placeholder={'10.80.40.0/24\n10.80.41.0/24\n10.80.50.12'}
        className="w-full rounded-lg border border-line bg-surface px-3 py-2 font-mono text-sm text-ink outline-none transition-colors focus:border-accent"
      />
      <button type="submit" disabled={pending} className={`mt-2 ${buttonClasses('secondary', 'sm')}`}>
        {pending ? 'Salvando...' : 'Salvar redes'}
      </button>
    </form>
  );
}
