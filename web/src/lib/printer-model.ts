// "Marca Modelo" for display ("HP LaserJet MFP M426dw", "Kyocera ECOSYS
// M3655idn"), just the brand when the model isn't known yet, null when
// neither is. Mirrors the API's formatPrinterModel. Kept out of lib/api.ts
// so client components can import it.
export function printerModelLabel(d: { manufacturer?: string | null; model?: string | null }): string | null {
  if (!d.model) return d.manufacturer ?? null;
  if (!d.manufacturer) return d.model;
  return `${d.manufacturer} ${d.model}`;
}

// Where the printer is: its IP, or for a printer plugged into a PC by USB
// (agent >= v0.1.27, host "USB:<computer>/<port>") "USB em <computer> (<port>)".
export function deviceAddressLabel(host: string): string {
  const m = /^USB:(.+)\/([^/]+)$/.exec(host);
  return m ? `USB em ${m[1]} (${m[2]})` : host;
}
