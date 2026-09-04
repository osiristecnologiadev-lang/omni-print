import { Injectable, Logger } from '@nestjs/common';
import { Device } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { IngestMetricDto } from './dto/ingest-payload.dto';
import { deepStripNul } from '../common/sanitize.util';

@Injectable()
export class IngestService {
  private readonly logger = new Logger(IngestService.name);

  constructor(private readonly prisma: PrismaService) {}

  // customerId comes from the agent token (AgentAuthGuard), never from the
  // request body - see that guard's comment. It's the whole point of
  // customer-scoped tokens: a newly discovered device is tagged with the
  // right customer from its very first ingest, no manual sorting needed.
  async ingest(
    tenantId: string,
    customerId: string | null,
    rawMetrics: IngestMetricDto[],
  ): Promise<{ received: number }> {
    // See sanitize.util.ts: strips NUL bytes a device may have returned in
    // any string field before anything touches Postgres.
    const metrics = rawMetrics.map((m) => deepStripNul(m));
    for (const metric of metrics) {
      const device = await this.upsertDevice(tenantId, customerId, metric);
      await this.prisma.metric.create({
        data: {
          deviceId: device.id,
          collectedAt: new Date(metric.collected_at),
          online: metric.online,
          sysDescr: metric.sys_descr,
          sysName: metric.sys_name,
          sysLocation: metric.sys_location,
          sysContact: metric.sys_contact,
          uptimeTicks: toBigInt(metric.uptime_ticks),
          consoleDisplay: metric.console_display,
          printerStatusCode: metric.printer_status_code,
          printerStatus: metric.printer_status,
          deviceStatusCode: metric.device_status_code,
          deviceStatus: metric.device_status,
          errorState: metric.error_state,
          pageCount: toBigInt(metric.page_count),
          monoPageCount: toBigInt(metric.mono_page_count),
          colorPageCount: toBigInt(metric.color_page_count),
          powerOnCount: toBigInt(metric.power_on_count),
          supplies: metric.supplies,
          inputTrays: metric.input_trays,
          alerts: metric.alerts,
          raw: metric.raw,
          errorMessage: metric.error,
        },
      });
    }
    return { received: metrics.length };
  }

  // Devices are matched primarily by serial number (stable across DHCP
  // re-leases), falling back to host when no serial has been seen yet for
  // this tenant. See prisma/schema.prisma's Device model comment.
  //
  // The host fallback alone isn't safe: if a customer physically swaps the
  // printer at an IP (old unit removed, a different one configured with the
  // same address), the new device's real serial won't match anything yet,
  // and naively matching "same host" would silently overwrite the OLD
  // device's row - serial, name, and (going forward) its metric history all
  // get attributed to what's now a different physical machine. That's not a
  // cosmetic mislabel: billing bases pages on *this device's own* counter
  // delta (see ContractsService.pagesInPeriod), so conflating two physical
  // units' counters the same way a counter reset does, except here there's
  // no way to "recover" - the new unit's low reading would look identical
  // to the old unit's counter resetting, and the two devices' real
  // histories would be permanently merged under one id.
  //
  // So the host match is only trusted when there's no serial conflict: the
  // existing device at that host has no serial yet (still being identified,
  // or an older/serial-less deployment), the incoming metric has no serial
  // this poll (a transient read failure on that one OID - assume same
  // device rather than churning a new row every time that OID hiccups), or
  // the serials already agree. Two different non-null serials at the same
  // host means the hardware changed - create a fresh device instead of
  // reusing the old row; the old row simply stops receiving updates and
  // ages out of "online" naturally, which is the correct outcome (it really
  // is gone). Confirmed this exact failure mode against real data this
  // session: ingesting a new serial at a host already used by another
  // device silently renamed/re-serialed that other device.
  private async upsertDevice(
    tenantId: string,
    customerId: string | null,
    metric: IngestMetricDto,
  ): Promise<Device> {
    const serial = metric.serial_number?.trim() || null;

    let device: Device | null = null;
    if (serial) {
      device = await this.prisma.device.findUnique({
        where: { tenantId_serialNumber: { tenantId, serialNumber: serial } },
      });
    }
    if (!device) {
      // orderBy matters once a swap has happened and two devices legitimately
      // share a host (see this method's comment) - if a later poll from the
      // new device fails to report its serial (a transient read failure,
      // same reasoning as the no-serial-conflict case below), the most
      // recently active device at that host is by far the better guess than
      // an arbitrary one, since the old device's binding to that host is
      // now historical.
      const hostDevice = await this.prisma.device.findFirst({
        where: { tenantId, host: metric.host },
        orderBy: { lastSeenAt: 'desc' },
      });
      const serialConflict = hostDevice?.serialNumber != null && serial != null && hostDevice.serialNumber !== serial;
      if (hostDevice && !serialConflict) {
        device = hostDevice;
      } else if (serialConflict) {
        this.logger.log(
          `host ${metric.host} previously belonged to device ${hostDevice!.id} (serial ${hostDevice!.serialNumber}) - ` +
            `new serial ${serial} doesn't match, treating as a physically different printer, not the same one reset`,
        );
      }
    }

    const data = {
      host: metric.host,
      name: metric.device_name,
      printerName: metric.printer_name,
      lastSeenAt: new Date(),
      ...(serial ? { serialNumber: serial } : {}),
    };

    if (device) {
      // Never overwrite an existing device's customerId here - once set (by
      // this same token-based tagging, or by an admin's manual reassignment
      // in the dashboard), later ingests shouldn't silently move it back.
      return this.prisma.device.update({ where: { id: device.id }, data });
    }

    this.logger.log(`new device for tenant ${tenantId}: ${metric.device_name} (${metric.host})`);
    return this.prisma.device.create({ data: { tenantId, customerId, ...data } });
  }
}

function toBigInt(value: number | undefined): bigint | undefined {
  return value == null ? undefined : BigInt(Math.trunc(value));
}
