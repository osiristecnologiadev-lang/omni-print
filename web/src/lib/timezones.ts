// Mirrors api/src/tenant/brazil-timezones.util.ts's BRAZIL_TIMEZONES list
// exactly (same "web/api don't share code" posture as lib/permissions.ts's
// mirror of auth/permissions.util.ts) - kept in sync by hand. Labels add
// the UTC offset since most admins know their city's offset better than
// its IANA zone name.
export const BRAZIL_TIMEZONE_OPTIONS = [
  { value: 'America/Noronha', label: 'Fernando de Noronha (UTC-2)' },
  { value: 'America/Sao_Paulo', label: 'Brasília, São Paulo, Rio de Janeiro (UTC-3)' },
  { value: 'America/Bahia', label: 'Salvador (UTC-3)' },
  { value: 'America/Fortaleza', label: 'Fortaleza (UTC-3)' },
  { value: 'America/Recife', label: 'Recife (UTC-3)' },
  { value: 'America/Araguaina', label: 'Araguaína (UTC-3)' },
  { value: 'America/Belem', label: 'Belém (UTC-3)' },
  { value: 'America/Maceio', label: 'Maceió (UTC-3)' },
  { value: 'America/Manaus', label: 'Manaus (UTC-4)' },
  { value: 'America/Cuiaba', label: 'Cuiabá (UTC-4)' },
  { value: 'America/Campo_Grande', label: 'Campo Grande (UTC-4)' },
  { value: 'America/Porto_Velho', label: 'Porto Velho (UTC-4)' },
  { value: 'America/Boa_Vista', label: 'Boa Vista (UTC-4)' },
  { value: 'America/Rio_Branco', label: 'Rio Branco (UTC-5)' },
  { value: 'America/Eirunepe', label: 'Eirunepé (UTC-5)' },
] as const;
