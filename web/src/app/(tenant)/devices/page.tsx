import { getCustomers, getDevices, getSession } from '@/lib/api';
import { deriveHealth } from '@/lib/health';
import { PageHeader } from '@/components/PageHeader';
import { EmptyState } from '@/components/EmptyState';
import { DeviceFleetTable } from '@/components/DeviceFleetTable';

// A dedicated, filterable view of the whole fleet - distinct from the
// dashboard's device table, which is the last section of a longer
// triage/analytics page. Requested directly: an MSP admin managing dozens
// of customers and hundreds of printers needs to find/narrow a device by
// customer or status without scrolling past everything else on /dashboard.
export default async function DevicesPage() {
  const session = await getSession();
  const isTenantWide = session != null && !session.customerId;

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
        />
      )}
    </main>
  );
}
