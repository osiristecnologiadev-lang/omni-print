'use client';

import { useState } from 'react';
import { TENANT_PERMISSION_OPTIONS, permissionLabel } from '@/lib/permissions';

const fieldClass =
  'rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none transition-colors focus:border-accent';

// Which checkbox set applies depends on whether a customer is selected -
// plain HTML can't react to that, so (like ContractForm.tsx's own
// conditional-field-visibility problem) this is a deliberate 'use client'
// exception. Checkboxes themselves stay uncontrolled (defaultChecked) -
// only the select's value is real component state.
export function PermissionsFields({ customers }: { customers: { id: string; name: string }[] }) {
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
          <fieldset className="rounded-lg border border-line p-3">
            <legend className="px-1 text-xs font-medium text-ink-muted">Módulos que esse usuário vai acessar</legend>
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {TENANT_PERMISSION_OPTIONS.map((key) => (
                <label key={key} className="flex items-center gap-2 text-sm text-ink">
                  <input type="checkbox" name="permissions" value={key} defaultChecked className="h-4 w-4" />
                  {permissionLabel(key)}
                </label>
              ))}
            </div>
          </fieldset>
        ) : (
          <label className="flex items-center gap-2 text-sm text-ink">
            <input type="checkbox" name="permissions" value="invoices_view" className="h-4 w-4" />
            {permissionLabel('invoices_view')}
          </label>
        )}
      </div>
    </>
  );
}
