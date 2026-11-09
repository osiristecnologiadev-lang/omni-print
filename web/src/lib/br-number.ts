// Reads a number typed the Brazilian way: "1.500,00" -> 1500, "0,04725" ->
// 0.04725, "450" -> 450. With a comma, dots are thousands separators; with
// no comma, a dot is the decimal point ("0.042" -> 0.042). NaN when it
// isn't a number at all.
export function parseBRNumber(raw: string | null | undefined): number {
  const s = String(raw ?? '').trim().replace(/\s|R\$/g, '');
  if (!s) return NaN;
  return Number(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s);
}
