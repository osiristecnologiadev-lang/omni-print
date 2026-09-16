// The real, currently-in-use IANA zones for Brazil (a handful of cities per
// zone share the same offset - this is the zone list, not every city).
// Curated rather than the full ~400-zone IANA list: a Brazilian outsourcing
// admin picking their own timezone shouldn't have to scroll past "Asia/
// Tokyo". Mirrored in web/src/lib/timezones.ts for the dropdown - kept in
// sync by hand (same posture as auth/permissions.util.ts's mirror in
// web/src/lib/permissions.ts).
export const BRAZIL_TIMEZONES = [
  'America/Noronha',
  'America/Sao_Paulo',
  'America/Bahia',
  'America/Fortaleza',
  'America/Recife',
  'America/Araguaina',
  'America/Belem',
  'America/Maceio',
  'America/Manaus',
  'America/Cuiaba',
  'America/Campo_Grande',
  'America/Porto_Velho',
  'America/Boa_Vista',
  'America/Rio_Branco',
  'America/Eirunepe',
] as const;
