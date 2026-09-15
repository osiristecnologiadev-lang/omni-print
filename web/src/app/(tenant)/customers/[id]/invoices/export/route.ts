import { getInvoices } from '@/lib/api';
import { csvResponse, toCsv } from '@/lib/csv';

const STATUS_LABEL: Record<string, string> = { PENDING: 'Pendente', PAID: 'Paga', CANCELLED: 'Cancelada' };

// Calendar dates (periodStart/periodEnd/dueDate) render in UTC, same
// reasoning as the invoices page's own formatDate default - they're a
// fixed date, not an instant, so the server's own timezone never shifts
// them by a day.
function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeZone: 'UTC' }).format(new Date(iso));
}

// No permission check here - getInvoices hits GET /v1/customers/:id/invoices,
// which already enforces assertInvoiceReadAccess server-side (same
// reasoning as the existing invoice-pdf proxy route one directory over).
export async function GET(_req: Request, ctx: RouteContext<'/customers/[id]/invoices/export'>) {
  const { id } = await ctx.params;
  const invoices = await getInvoices(id);

  const rows = invoices.map((inv) => [
    inv.number,
    formatDate(inv.periodStart),
    formatDate(inv.periodEnd),
    STATUS_LABEL[inv.status] ?? inv.status,
    formatDate(inv.dueDate),
    inv.paidAt ? formatDate(inv.paidAt) : '',
    Number(inv.totalDue).toFixed(2),
    inv.paidAmount ? Number(inv.paidAmount).toFixed(2) : '',
  ]);
  const csv = toCsv(
    ['Numero', 'Periodo inicio', 'Periodo fim', 'Status', 'Vencimento', 'Pago em', 'Total (R$)', 'Pago (R$)'],
    rows,
  );

  return csvResponse(`faturas-cliente-${id}.csv`, csv);
}
