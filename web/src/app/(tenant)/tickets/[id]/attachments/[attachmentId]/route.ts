import { fetchTicketAttachment } from '@/lib/api';

// Same proxy-through-server-side-auth reasoning as the invoice PDF route -
// a plain <a href> download link can't carry the httpOnly session cookie's
// bearer token itself. customerId isn't part of this URL (both the
// customer-scoped and the flat staff ticket page render this same link), so
// the caller passes it along as a query param - it already knows it from the
// ticket object being rendered.
export async function GET(req: Request, ctx: RouteContext<'/tickets/[id]/attachments/[attachmentId]'>) {
  const { id, attachmentId } = await ctx.params;
  const customerId = new URL(req.url).searchParams.get('customerId');
  if (!customerId) {
    return new Response('missing customerId', { status: 400 });
  }

  const upstream = await fetchTicketAttachment(customerId, id, attachmentId);

  return new Response(upstream.body, {
    status: 200,
    headers: {
      'Content-Type': upstream.headers.get('content-type') ?? 'application/octet-stream',
      'Content-Disposition': upstream.headers.get('content-disposition') ?? 'inline',
    },
  });
}
