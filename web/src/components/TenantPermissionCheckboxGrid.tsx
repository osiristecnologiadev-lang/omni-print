'use client';

import { useState } from 'react';
import { PERMISSION_PRESETS, TENANT_PERMISSION_OPTIONS, permissionDescription, permissionLabel } from '@/lib/permissions';

interface Props {
  // What should start checked - the target's current permissions on an
  // edit, or the viewer's own permissions (a sensible "give what I can
  // give" default) on a create form.
  defaultChecked: string[];
  // Keys exempt from the "you must hold this yourself to grant it" rule -
  // pass the target's CURRENT permissions on an edit (so saving an
  // unrelated change doesn't strip something the target already
  // legitimately had but the viewer themselves lacks), or [] on create
  // (nothing pre-existing to retain).
  retainable: string[];
  viewerPermissions: string[];
}

// Client component (needed for the preset quick-select buttons and for
// controlled checkboxes they update) shared by the create-user form and
// each existing user's "editar permissões" panel - see
// api/src/auth/permissions.util.ts's assertNoPrivilegeEscalation for the
// server-side rule this UI mirrors: a checkbox is disabled unless the
// viewer holds that key themselves OR the target already had it (so a
// disabled-but-still-granted box doesn't silently drop it on save, since a
// disabled checkbox never submits - keeping it CHECKED and ENABLED for the
// "already granted, viewer can't personally grant it, but can still
// retain/remove it" case is what makes that work).
export function TenantPermissionCheckboxGrid({ defaultChecked, retainable, viewerPermissions }: Props) {
  const [checked, setChecked] = useState<Set<string>>(new Set(defaultChecked));

  function canGrant(key: string): boolean {
    return viewerPermissions.includes(key) || retainable.includes(key);
  }

  function applyPreset(keys: readonly string[]) {
    setChecked(new Set(keys.filter(canGrant)));
  }

  return (
    <fieldset className="rounded-lg border border-line p-3">
      <legend className="px-1 text-xs font-medium text-ink-muted">Módulos que esse usuário vai acessar</legend>

      <div className="mb-3 flex flex-wrap gap-1.5">
        {PERMISSION_PRESETS.map((preset) => {
          const grantable = preset.keys.every(canGrant);
          return (
            <button
              key={preset.name}
              type="button"
              disabled={!grantable}
              title={grantable ? preset.description : 'Você não tem todas as permissões desse perfil para atribuí-lo.'}
              onClick={() => applyPreset(preset.keys)}
              className="rounded-full border border-line px-2.5 py-1 text-xs text-ink-muted transition-colors hover:border-accent hover:text-ink disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-line disabled:hover:text-ink-muted"
            >
              {preset.name}
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        {TENANT_PERMISSION_OPTIONS.map((key) => {
          const grantable = canGrant(key);
          return (
            <label key={key} className={`flex items-start gap-2 text-sm ${grantable ? 'text-ink' : 'text-ink-faint'}`}>
              <input
                type="checkbox"
                name="permissions"
                value={key}
                checked={checked.has(key)}
                disabled={!grantable}
                onChange={(e) =>
                  setChecked((prev) => {
                    const next = new Set(prev);
                    if (e.target.checked) next.add(key);
                    else next.delete(key);
                    return next;
                  })
                }
                className="mt-0.5 h-4 w-4"
              />
              <span>
                {permissionLabel(key)}
                <span className="block text-xs text-ink-faint">
                  {permissionDescription(key)}
                  {!grantable && ' Você não tem essa permissão para conceder.'}
                </span>
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
