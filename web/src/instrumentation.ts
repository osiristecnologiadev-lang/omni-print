// Next.js's built-in server-error hook (stable since 15.x, no config flag
// needed) - fires for uncaught errors in Server Components/Actions/Route
// Handlers, the closest equivalent web/ has to a global exception filter.
// Forwards to api/'s OpsAlertsController rather than emailing directly
// (see that controller's own comment) - keeps every "who gets alerted,
// how often" decision in one place instead of duplicating it here.
export async function onRequestError(
  err: { message?: string } | Error,
  request: { path: string },
): Promise<void> {
  const secret = process.env.OPS_ALERT_SECRET;
  if (!secret) return;

  const apiBaseUrl = process.env.API_BASE_URL ?? 'http://localhost:3000';
  // Best-effort and silent - an alerting mechanism must never itself throw
  // or add latency the original request didn't already have.
  await fetch(`${apiBaseUrl}/v1/ops/alert`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
    body: JSON.stringify({ message: err?.message ?? String(err), path: request?.path }),
  }).catch(() => undefined);
}
