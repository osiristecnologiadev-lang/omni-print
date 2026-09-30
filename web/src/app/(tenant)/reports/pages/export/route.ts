import { getDevicePagesReport } from '@/lib/api';
import { csvResponse, toCsv } from '@/lib/csv';

// Permission is enforced by the API (GET /v1/reports/device-pages asserts
// 'reports') - same as the usage-revenue export next door.
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const now = new Date();
  const year = Number(params.get('year')) || now.getFullYear();
  const month = Number(params.get('month')) || now.getMonth() + 1;
  const customerId = params.get('customerId') || undefined;
  const report = await getDevicePagesReport(year, month, customerId);

  const rows = report.rows.map((r) => [
    r.customerName ?? '',
    r.deviceName,
    r.serialNumber ?? '',
    r.host,
    r.startReading ?? '',
    r.startReadingAt ? r.startReadingAt.slice(0, 10) : '',
    r.endReading ?? '',
    r.endReadingAt ? r.endReadingAt.slice(0, 10) : '',
    r.startReading == null ? '' : r.pages,
    r.billingExcluded ? 'fora do contrato' : '',
  ]);
  const csv = toCsv(
    ['Cliente', 'Impressora', 'Serial', 'IP', 'Inicio', 'Data inicio', 'Fim', 'Data fim', 'Quantidade', 'Observacao'],
    rows,
  );

  return csvResponse(`paginas-por-impressora-${year}-${String(month).padStart(2, '0')}.csv`, csv);
}
