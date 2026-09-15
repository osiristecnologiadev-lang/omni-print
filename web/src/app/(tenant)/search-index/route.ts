import { getAllTickets, getCustomers, getDevices } from '@/lib/api';

// GlobalSearch (a 'use client' component) can't import lib/api directly -
// that module pulls in next/headers (cookies()) at the top level, which
// Next refuses to bundle into client code at all (a hard build error, not
// just a warning - see lib/pages.ts's own comment on the same problem for
// DeviceFleetTable). This Route Handler is the server-side boundary: it
// runs the existing tenant-scoped fetchers here, then hands the client a
// plain JSON response to fetch() directly.
export async function GET() {
  const [customers, devices, tickets] = await Promise.all([getCustomers(), getDevices(), getAllTickets()]);
  return Response.json({ customers, devices, tickets });
}
