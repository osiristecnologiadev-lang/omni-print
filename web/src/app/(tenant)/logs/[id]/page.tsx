import { forbidden } from 'next/navigation';
import { getAgentLogEntry, getViewerAccess, getViewerTimeZone } from '@/lib/api';
import { hasPermission } from '@/lib/permissions';
import { PageHeader } from '@/components/PageHeader';
import { Panel } from '@/components/Panel';

function formatDateTime(iso: string, timeZone?: string): string {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'medium', timeZone }).format(new Date(iso));
}

function formatDay(day: string): string {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(`${day}T00:00:00Z`));
}

export default async function LogEntryPage(props: PageProps<'/logs/[id]'>) {
  const { id } = await props.params;

  const access = await getViewerAccess();
  if (!hasPermission(access, 'agent')) {
    forbidden();
  }

  const [log, tz] = await Promise.all([getAgentLogEntry(id), getViewerTimeZone()]);

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <PageHeader title={formatDay(log.date)} subtitle="Voltar para ver todos os logs" back={{ href: '/logs', label: 'Voltar para Logs do Agent' }} />

      <Panel>
        <p className="mb-3 text-xs text-ink-faint">Enviado em {formatDateTime(log.uploadedAt, tz)}.</p>
        <pre className="max-h-[70vh] overflow-auto rounded-lg bg-surface-2 p-4 font-mono text-xs whitespace-pre-wrap text-ink">
          {log.content || '(log vazio)'}
        </pre>
      </Panel>
    </main>
  );
}
