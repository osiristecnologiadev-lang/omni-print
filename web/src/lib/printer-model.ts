// "Marca Modelo" for display ("HP LaserJet MFP M426dw", "Kyocera ECOSYS
// M3655idn"), just the brand when the model isn't known yet, null when
// neither is. Mirrors the API's formatPrinterModel. Kept out of lib/api.ts
// so client components can import it.
export function printerModelLabel(d: { manufacturer?: string | null; model?: string | null }): string | null {
  if (!d.model) return d.manufacturer ?? null;
  if (!d.manufacturer) return d.model;
  return `${d.manufacturer} ${d.model}`;
}
