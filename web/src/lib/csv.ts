// Minimal CSV encoder - quotes a field only when it actually needs it
// (contains a comma, quote, or newline), doubling embedded quotes per the
// CSV spec (RFC 4180). No library needed for this - same "don't reach for
// a dependency when a few lines suffice" pattern as InvoicePdfService's
// own hand-rolled table drawing.
function escapeCsvField(value: string | number): string {
  const s = String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(headers: string[], rows: Array<Array<string | number>>): string {
  const lines = [headers, ...rows].map((row) => row.map(escapeCsvField).join(','));
  // ﻿ (UTF-8 BOM) - without it, Excel (the realistic destination for
  // this, not just any CSV reader) guesses Windows-1252 and mangles
  // accented characters in customer names.
  return '﻿' + lines.join('\r\n');
}

export function csvResponse(filename: string, csv: string): Response {
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}
