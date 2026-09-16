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
  'billing',
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
  billing: 'Assinatura (cobrança, cartão, faturas)',
};

export function permissionLabel(key: string): string {
  return PERMISSION_LABEL[key] ?? key;
}

// One-line explanation shown under each checkbox - the audit finding this
// answers was literally "11 unexplained checkboxes" (see
// project-omniprint-ux-audit memory). Deliberately concrete about WHAT the
// module lets someone do, not a restatement of the label.
export const PERMISSION_DESCRIPTION: Record<string, string> = {
  contracts: 'Ver e negociar os contratos de cada cliente (preço, franquia, forma de cobrança).',
  invoices: 'Gerar, marcar como paga e cancelar faturas de qualquer cliente.',
  invoices_view: 'Ver as próprias faturas e boletos, sem acesso a mais nada do sistema.',
  customers: 'Cadastrar, editar e remover clientes.',
  agent: 'Gerar códigos de instalação e gerenciar tokens do agente de monitoramento.',
  users: 'Criar, revogar e alterar as permissões de outros usuários da equipe.',
  devices: 'Reatribuir dispositivos entre clientes e editar seus dados.',
  tickets: 'Ver e responder chamados de suporte de todos os clientes.',
  reports: 'Ver relatórios de uso e receita do parque completo.',
  audit_log: 'Ver o histórico de ações administrativas realizadas na conta.',
  settings: 'Editar os dados da empresa (razão social, endereço, contato).',
  notifications: 'Configurar quais alertas a equipe recebe por e-mail.',
  billing: 'Gerenciar a assinatura do OmniPrint: cartão, faturas e cancelamento.',
};

export function permissionDescription(key: string): string | undefined {
  return PERMISSION_DESCRIPTION[key];
}

// Quick-select bundles for the checkbox grid - a starting point the admin
// can still fine-tune afterward (these just set the checkboxes, they don't
// change how permissions are stored - still a flat string array). Answers
// the other half of the "11 unexplained checkboxes" finding: no guidance on
// what a normal role actually needs. Deliberately not persisted/enforced
// anywhere server-side - purely a frontend convenience, so adding/renaming a
// preset later needs no migration.
export const PERMISSION_PRESETS: { name: string; description: string; keys: readonly string[] }[] = [
  {
    name: 'Administrador',
    description: 'Acesso completo a todos os módulos.',
    keys: TENANT_PERMISSION_OPTIONS,
  },
  {
    name: 'Financeiro',
    description: 'Contratos, faturas, assinatura e relatórios.',
    keys: ['contracts', 'invoices', 'billing', 'reports'],
  },
  {
    name: 'Suporte técnico',
    description: 'Clientes, dispositivos e chamados - sem acesso a dados financeiros.',
    keys: ['customers', 'devices', 'tickets', 'agent'],
  },
];

export function hasPermission(access: ViewerAccess | null | undefined, key: string): boolean {
  return access?.permissions?.includes(key) ?? false;
}
