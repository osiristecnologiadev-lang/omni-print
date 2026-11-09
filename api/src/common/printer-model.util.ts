// Works out a printer's manufacturer and model from what the agent reports.
//
// Sources, best first:
//   1. hrDeviceDescr (HOST-RESOURCES-MIB, agent >= v0.1.27 sends it as
//      `model`) - on nearly every network printer it IS the model:
//      "HP LaserJet MFP M426dw", "Brother HL-L5100DN series", "ECOSYS M3655idn".
//      Agents running on Windows also send the driver/PJL model of USB
//      printers here.
//   2. sysDescr - some vendors put the model there ("RICOH P 311 V2.15 / ...",
//      "KONICA MINOLTA bizhub C224", HP JetDirect's "...,PID:HP LaserJet ...").
//   3. The printer's own name (prtGeneralPrinterName / web-page model / the
//      name the agent gave it) - only when it looks like a model, never a
//      hostname like "HPBFEAB2" or "BRN94DDF85031D3".
//
// The manufacturer also comes from sysObjectID's enterprise number when the
// agent sends it - the one source that doesn't depend on free text.

export interface PrinterIdentitySource {
  model?: string | null;
  sysObjectId?: string | null;
  sysDescr?: string | null;
  printerName?: string | null;
  deviceName?: string | null;
}

export interface PrinterIdentity {
  manufacturer: string | null;
  model: string | null;
}

// IANA enterprise numbers -> display name.
const ENTERPRISES: Record<string, string> = {
  '11': 'HP',
  '2435': 'Brother',
  '1347': 'Kyocera',
  '367': 'Ricoh',
  '18334': 'Konica Minolta',
  '2001': 'OKI',
  '1248': 'Epson',
  '236': 'Samsung',
  '641': 'Lexmark',
  '1602': 'Canon',
  '253': 'Xerox',
  '297': 'Fuji Xerox',
  '1129': 'Toshiba',
  '2385': 'Sharp',
  '40093': 'Pantum',
  '3369': 'Elgin',
};

// Text markers -> display name. Order matters: longer/more specific first.
const BRAND_PATTERNS: Array<[RegExp, string]> = [
  [/\bkonica\s*minolta\b|\bbizhub\b/i, 'Konica Minolta'],
  [/\bfuji\s*xerox\b|\bfujifilm\b/i, 'Fuji Xerox'],
  [/\bhewlett[\s-]*packard\b|\bhp\b|\blaserjet\b|\bofficejet\b|\bpagewide\b|\bdeskjet\b|\bjetdirect\b/i, 'HP'],
  [/\bbrother\b|^BRN[0-9A-F]{6,}/i, 'Brother'],
  [/^HP[0-9A-F]{6}$/i, 'HP'],
  [/^SEC[0-9A-F]{6,}/i, 'Samsung'],
  [/\bkyocera\b|\becosys\b|\btaskalfa\b/i, 'Kyocera'],
  [/\bricoh\b|\baficio\b|\blanier\b/i, 'Ricoh'],
  [/\boki\b|\bokilan\b|\bokidata\b/i, 'OKI'],
  [/\bepson\b|^(?:WF|L|ET)-?[A-Z]?\d{3,5}/i, 'Epson'],
  [/\bsamsung\b/i, 'Samsung'],
  [/\blexmark\b/i, 'Lexmark'],
  [/\bcanon\b|\bimagerunner\b|\bi-sensys\b/i, 'Canon'],
  [/\bxerox\b|\bversalink\b|\bworkcentre\b|\bphaser\b|\baltalink\b/i, 'Xerox'],
  [/\btoshiba\b|\be-studio\b/i, 'Toshiba'],
  [/\bsharp\b/i, 'Sharp'],
  [/\bpantum\b/i, 'Pantum'],
  [/\belgin\b/i, 'Elgin'],
  [/zebra/i, 'Zebra'],
];

// Strings that name a model (as opposed to a hostname or a network card).
const MODEL_RE = new RegExp(
  [
    String.raw`(?:HP\s+)?(?:Color\s+)?(?:LaserJet|OfficeJet|PageWide|DeskJet|Laser|Smart\s+Tank|Neverstop)\b[\w\s\-+/]{0,40}`,
    String.raw`(?:ECOSYS|TASKalfa|FS-)\s?[A-Z]{0,3}\d{3,5}[a-z]*\w*`,
    String.raw`bizhub\s+[A-Z]?\d{3,4}\w*`,
    String.raw`(?:RICOH\s+)?(?:Aficio\s+)?(?:SP|MP|IM|P|M|C)\s?C?\d{3,4}[A-Za-z]*`,
    String.raw`(?:Brother\s+)?(?:HL|DCP|MFC)-[A-Z0-9]{3,10}`,
    String.raw`(?:EPSON\s+)?(?:WF|L|ET|M)-?[CM]?\d{3,5}[A-Za-z]*(?:\s+Series)?`,
    String.raw`(?:OKI\s*)?(?:ES|MC|MB|B|C)\d{3,4}[a-z]*\w*`,
    String.raw`(?:Samsung\s+)?(?:SL-|ML-|SCX-|CLX-|M)\s?[A-Z]?\d{3,4}\w*`,
    String.raw`(?:Lexmark\s+)?(?:MX|MS|CX|CS|B|XM)\d{3,4}\w*`,
    String.raw`(?:VersaLink|AltaLink|WorkCentre|Phaser)\s+[A-Z]?\d{3,4}\w*`,
    String.raw`imageRUNNER\s+[\w\s]{2,20}`,
  ]
    // \b: a model starts a word - never read "C011" out of hostname "MFPBAC011".
    .map((alt) => String.raw`\b(?:` + alt + ')')
    .join('|'),
  'i',
);

// A bare hostname/MAC-ish token: HPBFEAB2, BRN94DDF85031D3, SEC8425191D0AC1, an IP.
const HOSTNAME_RE = /^(?:HP[0-9A-F]{6}|BRN[0-9A-F]{6,}|SEC[0-9A-F]{6,}|KM[0-9A-F]{6}|NPI[0-9A-F]{6}|\d{1,3}(?:\.\d{1,3}){3})$/i;

export function identifyPrinter(src: PrinterIdentitySource): PrinterIdentity {
  const model = pickModel(src);
  const manufacturer =
    brandFromSysObjectId(src.sysObjectId) ??
    brandFromText(model) ??
    brandFromText(src.sysDescr) ??
    brandFromText(src.printerName) ??
    brandFromText(src.deviceName);
  return { manufacturer, model: model ? stripBrand(model, manufacturer) : null };
}

// "Marca Modelo" for display - e.g. "HP LaserJet MFP M426dw", "Kyocera ECOSYS M3655idn".
export function formatPrinterModel(manufacturer: string | null, model: string | null): string | null {
  if (!model) return manufacturer;
  if (!manufacturer) return model;
  return `${manufacturer} ${model}`;
}

function pickModel(src: PrinterIdentitySource): string | null {
  const hr = clean(src.model);
  if (hr && !isUseless(hr)) return tidy(hr);

  const descr = clean(src.sysDescr);
  if (descr) {
    const pid = /PID:([^,]+)/i.exec(descr);
    if (pid && MODEL_RE.test(pid[1])) return tidy(pid[1]);
    const ricoh = /^(RICOH\s+[^/]+?)\s+V?\d+(?:\.\d+)+/i.exec(descr);
    if (ricoh) return tidy(ricoh[1]);
    const konica = /^KONICA MINOLTA\s+(.+)$/i.exec(descr);
    if (konica) return tidy(konica[1]);
    // "Samsung M4080FX; V11.01...", "HP Laser MFP 432fdn; V4.00..."
    const semi = /^((?:Samsung|HP|Xerox|Pantum|Lexmark)\s+[^;]{2,40});/i.exec(descr);
    if (semi) return tidy(semi[1]);
    // "Zebra Technologies ZD230-203dpi / internal..."
    const zebra = /^Zebra Technologies\s+([A-Z0-9]+)/i.exec(descr);
    if (zebra) return tidy(`Zebra ${zebra[1]}`);
  }

  for (const name of [src.printerName, src.deviceName]) {
    const n = clean(name);
    if (!n || HOSTNAME_RE.test(n)) continue;
    // "OKI-ES5112-D14958" -> "OKI ES5112"; "RICOH SP 377DNwX (f42ddf)" -> "RICOH SP 377DNwX"
    const unwrapped = n.replace(/\s*\([0-9a-f]{4,}\)\s*$/i, '').replace(/^OKI-([A-Z]+\d+)-[0-9A-F]{4,}$/i, 'OKI $1');
    const m = MODEL_RE.exec(unwrapped);
    if (m && m[0].trim().length >= 4) return tidy(m[0]);
  }
  return null;
}

function brandFromSysObjectId(oid: string | null | undefined): string | null {
  const m = oid ? /^\.?1\.3\.6\.1\.4\.1\.(\d+)/.exec(oid.trim()) : null;
  return m ? ENTERPRISES[m[1]] ?? null : null;
}

function brandFromText(text: string | null | undefined): string | null {
  const t = clean(text);
  if (!t) return null;
  for (const [re, brand] of BRAND_PATTERNS) if (re.test(t)) return brand;
  return null;
}

// Drop a leading brand word the display adds back: "HP LaserJet ..." -> "LaserJet ...",
// "Brother HL-L5100DN" -> "HL-L5100DN", "KONICA MINOLTA bizhub" -> "bizhub".
function stripBrand(model: string, manufacturer: string | null): string {
  if (!manufacturer) return model;
  const words = manufacturer === 'HP' ? ['HP', 'Hewlett-Packard', 'Hewlett Packard'] : [manufacturer, manufacturer.toUpperCase()];
  for (const w of words) {
    const re = new RegExp(`^${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+`, 'i');
    if (re.test(model)) return model.replace(re, '').trim() || model;
  }
  return model;
}

function tidy(s: string): string {
  return s
    .replace(/\s+series$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function clean(s: string | null | undefined): string | null {
  const t = s?.replace(/\s+/g, ' ').trim();
  return t ? t : null;
}

// hrDeviceDescr values that don't name anything.
function isUseless(s: string): boolean {
  return /^(?:printer|network printer|unknown|generic|-+|\d+)$/i.test(s) || HOSTNAME_RE.test(s);
}
