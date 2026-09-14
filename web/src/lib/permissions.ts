import type { ViewerAccess } from './api';

// Mirrors api/src/auth/permissions.util.ts's key list exactly - kept as a
// plain string union here (not imported from the API package) since web/
// and api/ are separate builds; TENANT_PERMISSION_OPTIONS below is the
// single place a new key needs adding on the frontend.
export const TENANT_PERMISSION_OPTIONS = [
  'contracts',
  'invoices',
  'customers',
  'agent',
  'users',
  'devices',
  'tickets',
  'reports',
  'audit_log',
  'settings',
  'notifications',
] as const;

// Translated to Portuguese only here at display time - same pattern as
// ACTION_LABEL in audit-log/page.tsx. Anything missing falls back to the
// raw key, so a forgotten translation is visible, not silently hidden.
export const PERMISSION_LABEL: Record<string, string> = {
  contracts: 'Contratos',
  invoices: 'Faturas (gerar, pagar, cancelar)',
  invoices_view: 'Ver faturas e boletos',
  customers: 'Clientes',
  agent: 'Agente (tokens e instalação)',
  users: 'Usuários',
  devices: 'Dispositivos (reatribuir, editar)',
  tickets: 'Chamados (fila da equipe)',
  reports: 'Relatórios',
  audit_log: 'Log de auditoria',
  settings: 'Empresa',
  notifications: 'Notificações',
};

export function permissionLabel(key: string): string {
  return PERMISSION_LABEL[key] ?? key;
}

export function hasPermission(access: ViewerAccess | null | undefined, key: string): boolean {
  return access?.permissions?.includes(key) ?? false;
}
