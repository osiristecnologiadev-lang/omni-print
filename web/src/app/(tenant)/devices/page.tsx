import { getCustomers, getDevices, getSession, getViewerAccess } from '@/lib/api';
import { hasPermission } from '@/lib/permissions';
import { deriveHealth } from '@/lib/health';
import { PageHeader } from '@/components/PageHeader';
import { EmptyState } from '@/components/EmptyState';
import { DeviceFleetTable } from '@/components/DeviceFleetTable';
import { bulkAssignDevicesAction } from './actions';

// A dedicated, filterable view of the whole fleet - distinct from the
// dashboard's device table, which is the last section of a longer
// triage/analytics page. Requested directly: an MSP admin managing dozens
// of customers and hundreds of printers needs to find/narrow a device by
// customer or status without scrolling past everything else on /dashboard.
export default async function DevicesPage() {
  const [session, access] = await Promise.all([getSession(), getViewerAccess()]);
  const isTenantWide = session != null && !session.customerId;
  // Same gate the underlying PATCH /v1/devices/:id already enforces - a
  // tenant-wide user without the 'devices' permission (e.g. a technician
  // with only tickets/devices-view access) gets the filterable list but
  // not the checkbox column/bulk-assign bar.
  const canAssign = isTenantWide && hasPermission(access, 'devices');

  const [devices, customers] = await Promise.all([getDevices(), isTenantWide ? getCustomers() : Promise.resolve([])]);

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <PageHeader
        title="Dispositivos"
        subtitle={`${devices.length} dispositivo${devices.length === 1 ? '' : 's'} monitorado${devices.length === 1 ? '' : 's'}`}
      />

      {devices.length === 0 ? (
        <EmptyState
          title="Nenhum dispositivo ainda"
          hint="Configure o agente (agent/config.yaml) e aguarde o primeiro ciclo de coleta."
        />
      ) : (
        <DeviceFleetTable
          devices={devices.map((d) => ({ ...d, health: deriveHealth(d.latestMetric) }))}
          isTenantWide={isTenantWide}
          customers={isTenantWide ? customers : undefined}
          showStatusFilter
          onBulkAssign={canAssign ? bulkAssignDevicesAction : undefined}
        />
      )}
    </main>
  );
}
