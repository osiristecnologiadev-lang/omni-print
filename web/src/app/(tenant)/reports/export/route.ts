import { getUsageRevenueReport } from '@/lib/api';
import { csvResponse, toCsv } from '@/lib/csv';

// Same 4 options the page itself offers - no separate validation needed,
// getUsageRevenueReport/the API's own months param already falls back to
// 12 on anything else. No permission check here either: getUsageRevenueReport
// hits GET /v1/reports/usage-revenue, which already assertPermission(req,
// 'reports') server-side - same reasoning as the existing invoice-pdf
// proxy route, which does zero auth work of its own.
export async function GET(req: Request) {
  const months = Number(new URL(req.url).searchParams.get('months')) || 12;
  const report = await getUsageRevenueReport(months);

  const rows = report.byCustomer.map((c) => [
    c.customerName,
    c.invoiceCount,
    c.totalPages,
    c.totalDue.toFixed(2),
    c.paidAmount.toFixed(2),
    c.outstanding.toFixed(2),
  ]);
  const csv = toCsv(['Cliente', 'Faturas', 'Paginas', 'Faturado (R$)', 'Recebido (R$)', 'Em aberto (R$)'], rows);

  return csvResponse(`receita-por-cliente-${months}m.csv`, csv);
}
