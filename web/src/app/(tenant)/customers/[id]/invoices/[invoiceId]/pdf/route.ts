import { fetchInvoicePdf } from '@/lib/api';

// Proxies the API's PDF stream through to the browser. Needed because the
// download has to come from a plain <a href> (so the browser handles it as
// a normal navigation/download), and that link can't carry the httpOnly
// session cookie's bearer token itself - this route reads it server-side
// (via fetchInvoicePdf -> lib/api's authHeaders) and passes the bytes along.
export async function GET(_req: Request, ctx: RouteContext<'/customers/[id]/invoices/[invoiceId]/pdf'>) {
  const { id, invoiceId } = await ctx.params;
  const upstream = await fetchInvoicePdf(id, invoiceId);

  return new Response(upstream.body, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': upstream.headers.get('content-disposition') ?? 'inline',
    },
  });
}
