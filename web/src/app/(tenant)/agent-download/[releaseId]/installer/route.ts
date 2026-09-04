import { fetchAgentInstaller } from '@/lib/api';

// Same reasoning as customers/[id]/invoices/[invoiceId]/pdf/route.ts - the
// download has to come from a plain <a href> so the browser handles it as a
// normal download, and that link can't carry the httpOnly session cookie's
// bearer token itself.
export async function GET(_req: Request, ctx: RouteContext<'/agent-download/[releaseId]/installer'>) {
  const { releaseId } = await ctx.params;
  const upstream = await fetchAgentInstaller(releaseId);

  return new Response(upstream.body, {
    status: 200,
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': upstream.headers.get('content-disposition') ?? 'attachment',
    },
  });
}
