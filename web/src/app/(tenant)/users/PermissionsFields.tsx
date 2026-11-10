'use client';

import { useState } from 'react';
import { permissionLabel } from '@/lib/permissions';
import { TenantPermissionCheckboxGrid } from '@/components/TenantPermissionCheckboxGrid';

const fieldClass =
  'rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none transition-colors focus:border-accent';

// Which checkbox set applies depends on whether a customer is selected -
// plain HTML can't react to that, so (like ContractForm.tsx's own
// conditional-field-visibility problem) this is a deliberate 'use client'
// exception.
export function PermissionsFields({
  customers,
  viewerPermissions,
}: {
  customers: { id: string; name: string }[];
  viewerPermissions: string[];
}) {
  const [customerId, setCustomerId] = useState('');

  return (
    <>
      <select
        name="customerId"
        value={customerId}
        onChange={(e) => setCustomerId(e.target.value)}
        className={fieldClass}
      >
        <option value="">Equipe (vê todos os clientes)</option>
        {customers.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>

      <div className="sm:col-span-2">
        {customerId === '' ? (
          // No pre-existing target to retain from on a create - a key can
          // only be granted here if the viewer holds it themselves (see
          // TenantPermissionCheckboxGrid). Starts with NOTHING checked
          // (usability review 2026-11-09: it used to start with everything
          // the viewer holds, so a quick "create user" silently gave full
          // access) - pick a profile above the boxes or tick modules.
          <>
            <p className="mb-2 text-xs text-ink-faint">
              Escolha um perfil (Administrador, Financeiro, Suporte técnico) ou marque só os módulos que essa pessoa precisa.
            </p>
            <TenantPermissionCheckboxGrid defaultChecked={[]} retainable={[]} viewerPermissions={viewerPermissions} />
          </>
        ) : (
          // invoices_view is the one customer-scoped key - not an
          // escalation vector for a (necessarily tenant-wide) viewer, see
          // assertNoPrivilegeEscalation - so it's never disabled here.
          <label className="flex items-center gap-2 text-sm text-ink">
            <input type="checkbox" name="permissions" value="invoices_view" className="h-4 w-4" />
            {permissionLabel('invoices_view')}
          </label>
        )}
      </div>
    </>
  );
}
