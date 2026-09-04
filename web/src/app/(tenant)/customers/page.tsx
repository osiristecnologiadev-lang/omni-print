import Link from 'next/link';
import { forbidden } from 'next/navigation';
import { getCustomers, getSession } from '@/lib/api';
import { createCustomerAction } from './actions';
import { PageHeader } from '@/components/PageHeader';
import { EmptyState } from '@/components/EmptyState';
import { Button } from '@/components/Button';

export default async function CustomersPage() {
  const session = await getSession();
  if (session?.customerId) {
    forbidden();
  }

  const customers = await getCustomers();

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <PageHeader
        title="Clientes"
        subtitle="Empresas que você atende. Atribua impressoras a um cliente na página de cada dispositivo."
      />

      <form action={createCustomerAction} className="flex gap-2">
        <input
          name="name"
          placeholder="Nome do cliente"
          required
          className="flex-1 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none transition-colors focus:border-accent"
        />
        <Button type="submit" variant="primary">
          Adicionar
        </Button>
      </form>

      {customers.length === 0 ? (
        <div className="mt-6">
          <EmptyState title="Nenhum cliente cadastrado ainda" />
        </div>
      ) : (
        <ul className="mt-6 divide-y divide-line rounded-xl border border-line bg-surface">
          {customers.map((c) => (
            <li key={c.id} className="flex items-center justify-between px-4 py-3">
              <Link href={`/customers/${c.id}`} className="font-medium text-ink transition-colors hover:text-accent">
                {c.name}
              </Link>
              <span className="text-sm text-ink-muted">
                {c._count?.devices ?? 0} dispositivo{(c._count?.devices ?? 0) === 1 ? '' : 's'}
              </span>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
