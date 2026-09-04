import { Injectable } from '@nestjs/common';
import * as PDFDocument from 'pdfkit';

interface InvoicePerDevice {
  deviceId: string;
  deviceName: string;
  serialNumber?: string | null;
  pages: number;
  monoPages?: number;
  colorPages?: number;
  startReading?: number | null;
  endReading?: number | null;
  counterReset?: boolean;
}

interface PartyInfo {
  name: string;
  document?: string | null;
  address?: string | null;
  phone?: string | null;
  contactEmail?: string | null;
}

interface InvoicePdfInput {
  invoice: {
    id: string;
    number: number;
    periodStart: Date;
    periodEnd: Date;
    dueDate: Date;
    status: string;
    pricingModel: string;
    totalPages: number;
    monoPages: number | null;
    colorPages: number | null;
    perDevice: unknown;
    fixedFee: unknown;
    usageCost: unknown;
    totalDue: unknown;
    paidAt: Date | null;
    generatedAt: Date;
  };
  issuer: PartyInfo;
  customer: PartyInfo;
}

const STATUS_LABEL: Record<string, string> = { PENDING: 'Pendente', PAID: 'Paga', CANCELLED: 'Cancelada' };
const STATUS_COLOR: Record<string, { bg: string; fg: string }> = {
  PENDING: { bg: '#fef3c7', fg: '#92400e' },
  PAID: { bg: '#d1fae5', fg: '#065f46' },
  CANCELLED: { bg: '#e5e7eb', fg: '#374151' },
};
const MODEL_LABEL: Record<string, string> = {
  FLAT_RATE: 'Mensalidade fixa',
  ALLOWANCE_PLUS_OVERAGE: 'Franquia com excedente',
  PER_PAGE: 'Por página com mínimo',
};

const INK = '#111827';
const MUTED = '#6b7280';
const FAINT = '#9ca3af';
const BORDER = '#e5e7eb';
const ACCENT = '#1d4ed8';
const ACCENT_SOFT = '#eff6ff';
const ROW_ALT = '#f9fafb';

function money(v: unknown): string {
  return `R$ ${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function fmtDate(d: Date): string {
  return new Date(d).toLocaleDateString('pt-BR', { timeZone: 'UTC' });
}
function fmtInt(n: number): string {
  return n.toLocaleString('pt-BR');
}
function invoiceNumber(n: number): string {
  return `Nº ${String(n).padStart(6, '0')}`;
}
function fmtReading(n: number | null | undefined): string {
  return n == null ? '—' : fmtInt(n);
}

@Injectable()
export class InvoicePdfService {
  // Returns the open PDFKit document - caller pipes it to a response and
  // must call .end() once piping is set up (kept here so callers control
  // exactly when the stream starts flowing).
  build({ invoice, issuer, customer }: InvoicePdfInput): PDFKit.PDFDocument {
    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    const left = doc.page.margins.left;
    const right = doc.page.width - doc.page.margins.right;
    const contentWidth = right - left;
    const perDevice = (invoice.perDevice as InvoicePerDevice[] | null) ?? [];
    const hasColorSplit = (invoice.colorPages ?? 0) > 0;
    const statusColor = STATUS_COLOR[invoice.status] ?? STATUS_COLOR.PENDING;

    // --- Header: issuer identity (left) / invoice number + status (right) ---
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(20).text(issuer.name, left, 40, { width: contentWidth * 0.62 });
    let contactY = doc.y + 2;
    doc.font('Helvetica').fontSize(9).fillColor(MUTED);
    for (const line of partyContactLines(issuer)) {
      doc.text(line, left, contactY, { width: contentWidth * 0.62 });
      contactY = doc.y;
    }

    doc.font('Helvetica').fontSize(10).fillColor(MUTED).text('FATURA', 0, 40, { width: right, align: 'right' });
    doc
      .font('Helvetica-Bold')
      .fontSize(14)
      .fillColor(INK)
      .text(invoiceNumber(invoice.number), 0, doc.y, { width: right, align: 'right' });

    const pillLabel = STATUS_LABEL[invoice.status] ?? invoice.status;
    const pillWidth = doc.font('Helvetica-Bold').fontSize(9).widthOfString(pillLabel) + 16;
    const pillY = doc.y + 6;
    doc.roundedRect(right - pillWidth, pillY, pillWidth, 18, 9).fill(statusColor.bg);
    doc
      .fillColor(statusColor.fg)
      .font('Helvetica-Bold')
      .fontSize(9)
      .text(pillLabel, right - pillWidth, pillY + 5, { width: pillWidth, align: 'center' });

    const headerBottom = Math.max(contactY, pillY + 28);
    doc
      .moveTo(left, headerBottom)
      .lineTo(right, headerBottom)
      .lineWidth(2)
      .strokeColor(ACCENT)
      .stroke();

    // --- Issuer / customer two-column block ---
    let y = headerBottom + 16;
    const colWidth = (contentWidth - 16) / 2;
    y = drawPartyBox(doc, 'PRESTADOR', issuer, left, y, colWidth);
    const customerBoxBottom = drawPartyBox(doc, 'CLIENTE', customer, left + colWidth + 16, headerBottom + 16, colWidth);
    y = Math.max(y, customerBoxBottom) + 16;

    // --- Period / due date / issued date strip ---
    const stripCols = [
      { label: 'PERÍODO', value: `${fmtDate(invoice.periodStart)} – ${fmtDate(invoice.periodEnd)}` },
      { label: 'VENCIMENTO', value: fmtDate(invoice.dueDate) },
      { label: 'EMISSÃO', value: fmtDate(invoice.generatedAt) },
      { label: 'MODELO', value: MODEL_LABEL[invoice.pricingModel] ?? invoice.pricingModel },
    ];
    const stripColWidth = contentWidth / stripCols.length;
    doc.font('Helvetica').fontSize(8).fillColor(MUTED);
    stripCols.forEach((c, i) => doc.text(c.label, left + i * stripColWidth, y, { width: stripColWidth - 8 }));
    y = doc.y + 2;
    doc.font('Helvetica-Bold').fontSize(10.5).fillColor(INK);
    stripCols.forEach((c, i) => doc.text(c.value, left + i * stripColWidth, y, { width: stripColWidth - 8 }));
    y = doc.y + 16;

    // --- Itemized usage table ---
    doc.font('Helvetica-Bold').fontSize(11).fillColor(INK).text('Uso por equipamento', left, y);
    y = doc.y + 8;

    // Equipamento/Nº Série identify the physical unit; Leitura Anterior/
    // Atual are the meter-reading proof behind the billed page count - the
    // standard way outsourcing-de-impressão invoices in this market justify
    // that number, not just showing the delta on its own.
    const columns = hasColorSplit
      ? [
          { title: 'Equipamento', width: contentWidth * 0.24, align: 'left' as const },
          { title: 'Nº Série', width: contentWidth * 0.14, align: 'left' as const },
          { title: 'Leitura ant.', width: contentWidth * 0.14, align: 'right' as const },
          { title: 'Leitura atual', width: contentWidth * 0.14, align: 'right' as const },
          { title: 'P&B', width: contentWidth * 0.12, align: 'right' as const },
          { title: 'Cor', width: contentWidth * 0.11, align: 'right' as const },
          { title: 'Total', width: contentWidth * 0.11, align: 'right' as const },
        ]
      : [
          { title: 'Equipamento', width: contentWidth * 0.32, align: 'left' as const },
          { title: 'Nº Série', width: contentWidth * 0.2, align: 'left' as const },
          { title: 'Leitura ant.', width: contentWidth * 0.18, align: 'right' as const },
          { title: 'Leitura atual', width: contentWidth * 0.16, align: 'right' as const },
          { title: 'Páginas', width: contentWidth * 0.14, align: 'right' as const },
        ];

    y = drawTableHeader(doc, columns, left, y);

    const bottomLimit = doc.page.height - doc.page.margins.bottom - 90; // leaves room for totals + footer
    if (perDevice.length === 0) {
      doc.font('Helvetica').fontSize(9).fillColor(MUTED).text('Nenhum equipamento no período.', left + 6, y + 6);
      y += 24;
    } else {
      perDevice.forEach((d, i) => {
        // A long device list would otherwise draw straight past the page
        // edge (this is a manually-drawn table, not a flowing pdfkit
        // primitive) - break to a new page and repeat the header so it
        // stays readable rather than silently clipping rows.
        if (y + 20 > bottomLimit) {
          doc.addPage();
          y = doc.page.margins.top;
          y = drawTableHeader(doc, columns, left, y);
        }
        // Asterisk flags a mid-period counter reset (device reset/replaced) -
        // pages already account for it correctly (see pagesInPeriod), this
        // just tells whoever reads the invoice why start/end readings alone
        // don't arithmetically explain the total.
        const nameCell = d.counterReset ? `${d.deviceName} *` : d.deviceName;
        const readingCols = [d.serialNumber || '—', fmtReading(d.startReading), fmtReading(d.endReading)];
        const rowValues = hasColorSplit
          ? [nameCell, ...readingCols, fmtInt(d.monoPages ?? d.pages), fmtInt(d.colorPages ?? 0), fmtInt(d.pages)]
          : [nameCell, ...readingCols, fmtInt(d.pages)];
        y = drawTableRow(doc, columns, rowValues, left, y, i % 2 === 1);
      });
    }
    // Table bottom border
    doc.moveTo(left, y).lineTo(right, y).lineWidth(0.5).strokeColor(BORDER).stroke();
    y += 8;

    if (perDevice.some((d) => d.counterReset)) {
      doc
        .font('Helvetica')
        .fontSize(7.5)
        .fillColor(MUTED)
        .text('* contador reiniciado durante o período (equipamento resetado/substituído) - páginas já recalculadas corretamente.', left, y, {
          width: contentWidth,
        });
      y = doc.y + 4;
    }

    doc
      .font('Helvetica-Bold')
      .fontSize(9.5)
      .fillColor(INK)
      .text(`Total de páginas: ${fmtInt(invoice.totalPages)}`, left, y, { width: contentWidth, align: 'right' });
    y = doc.y + 20;

    // --- Totals summary box ---
    const boxWidth = 220;
    const boxX = right - boxWidth;
    const lines = [
      { label: 'Taxa fixa', value: money(invoice.fixedFee) },
      { label: 'Uso', value: money(invoice.usageCost) },
    ];
    doc.font('Helvetica').fontSize(9.5).fillColor(MUTED);
    let sy = y;
    for (const line of lines) {
      doc.text(line.label, boxX, sy);
      doc.text(line.value, boxX, sy, { width: boxWidth, align: 'right' });
      sy = doc.y + 4;
    }
    doc.moveTo(boxX, sy).lineTo(right, sy).lineWidth(0.5).strokeColor(BORDER).stroke();
    sy += 8;

    doc.roundedRect(boxX, sy, boxWidth, 34, 4).fill(ACCENT_SOFT);
    doc.font('Helvetica-Bold').fontSize(9).fillColor(ACCENT).text('TOTAL DEVIDO', boxX + 12, sy + 8);
    doc
      .font('Helvetica-Bold')
      .fontSize(15)
      .fillColor(ACCENT)
      .text(money(invoice.totalDue), boxX, sy + 6, { width: boxWidth - 12, align: 'right' });
    y = sy + 34 + 24;

    // --- Payment note ---
    doc.font('Helvetica').fontSize(9).fillColor(MUTED);
    if (invoice.status === 'PAID' && invoice.paidAt) {
      doc.fillColor('#065f46').text(`Pagamento confirmado em ${fmtDate(invoice.paidAt)}.`, left, y);
    } else if (invoice.status === 'CANCELLED') {
      doc.text('Fatura cancelada - nenhum pagamento é devido.', left, y);
    } else {
      doc.text('Pagamento conforme condições combinadas com o prestador.', left, y);
    }

    // --- Footer ---
    const footerY = doc.page.height - doc.page.margins.bottom - 14;
    doc
      .font('Helvetica')
      .fontSize(7.5)
      .fillColor(FAINT)
      .text(`Fatura ${invoiceNumber(invoice.number)} · ${invoice.id}`, left, footerY, { width: contentWidth * 0.7 });
    doc
      .font('Helvetica')
      .fontSize(7.5)
      .fillColor(FAINT)
      .text('Gerado via OmniPrint', 0, footerY, { width: right, align: 'right' });

    return doc;
  }
}

function partyContactLines(party: PartyInfo): string[] {
  const lines: string[] = [];
  if (party.document) lines.push(`CNPJ/CPF: ${party.document}`);
  if (party.address) lines.push(party.address);
  const contact = [party.phone, party.contactEmail].filter(Boolean).join(' · ');
  if (contact) lines.push(contact);
  return lines;
}

function drawPartyBox(
  doc: PDFKit.PDFDocument,
  title: string,
  party: PartyInfo,
  x: number,
  y: number,
  width: number,
): number {
  const padding = 10;
  const startY = y;
  doc.font('Helvetica-Bold').fontSize(8).fillColor(MUTED).text(title, x + padding, y + padding, { width: width - padding * 2 });
  doc
    .font('Helvetica-Bold')
    .fontSize(11)
    .fillColor(INK)
    .text(party.name, x + padding, doc.y + 2, { width: width - padding * 2 });
  doc.font('Helvetica').fontSize(9).fillColor(MUTED);
  const lines = partyContactLines(party);
  if (lines.length === 0) {
    doc.fillColor(FAINT).text('—', x + padding, doc.y + 2, { width: width - padding * 2 });
  } else {
    for (const line of lines) {
      doc.text(line, x + padding, doc.y + 2, { width: width - padding * 2 });
    }
  }
  const boxHeight = doc.y + padding - startY;
  doc.roundedRect(x, startY, width, boxHeight, 4).lineWidth(0.75).strokeColor(BORDER).stroke();
  return startY + boxHeight;
}

interface TableColumn {
  title: string;
  width: number;
  align: 'left' | 'right';
}

function drawTableHeader(doc: PDFKit.PDFDocument, columns: TableColumn[], x: number, y: number): number {
  const rowHeight = 22;
  const totalWidth = columns.reduce((sum, c) => sum + c.width, 0);
  doc.rect(x, y, totalWidth, rowHeight).fill(ACCENT_SOFT);
  let cx = x;
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor(ACCENT);
  for (const col of columns) {
    doc.text(col.title.toUpperCase(), cx + 6, y + 7, {
      width: col.width - 12,
      align: col.align,
      ellipsis: true,
      lineBreak: false,
    });
    cx += col.width;
  }
  return y + rowHeight;
}

function drawTableRow(
  doc: PDFKit.PDFDocument,
  columns: TableColumn[],
  values: string[],
  x: number,
  y: number,
  shaded: boolean,
): number {
  const rowHeight = 20;
  const totalWidth = columns.reduce((sum, c) => sum + c.width, 0);
  if (shaded) {
    doc.rect(x, y, totalWidth, rowHeight).fill(ROW_ALT);
  }
  let cx = x;
  doc.font('Helvetica').fontSize(8.5).fillColor(INK);
  columns.forEach((col, i) => {
    // ellipsis, not wrap: a long device name/serial in a fixed-height row
    // would otherwise wrap onto a second line and get clipped by the next
    // row's shading instead of just truncating cleanly.
    doc.text(values[i], cx + 6, y + 6, { width: col.width - 12, align: col.align, ellipsis: true, lineBreak: false });
    cx += col.width;
  });
  return y + rowHeight;
}
