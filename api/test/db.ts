// Real-database helpers for the integration tests (test/*.int-spec.ts).
// They run against a throwaway Postgres+TimescaleDB with every migration
// applied - never production: refuse any DATABASE_URL that doesn't look like
// a test database.
import { PrismaService } from '../src/prisma/prisma.service';
import { DevicePagesService } from '../src/common/device-pages.service';
import { ContractsService } from '../src/contracts/contracts.service';
import { InvoicesService } from '../src/invoices/invoices.service';
import { DevicesService } from '../src/devices/devices.service';
import { IngestService } from '../src/ingest/ingest.service';

export function connect() {
  const url = process.env.DATABASE_URL ?? '';
  if (!/test|localhost|127\.0\.0\.1/.test(url)) {
    throw new Error(`integration tests refuse to run against ${url.replace(/:[^:@/]*@/, ':***@')} - point DATABASE_URL at a test database`);
  }
  const prisma = new PrismaService();
  const devicePages = new DevicePagesService(prisma);
  const contracts = new ContractsService(prisma, devicePages);
  const invoices = new InvoicesService(prisma, contracts);
  const devices = new DevicesService(prisma, devicePages);
  const ingest = new IngestService(prisma);
  return { prisma, contracts, invoices, devices, ingest };
}

// Wipes every tenant-owned row (CASCADE follows the foreign keys).
export async function reset(prisma: PrismaService) {
  await prisma.$executeRawUnsafe('TRUNCATE TABLE metrics, invoices, contracts, devices, customers, tenants RESTART IDENTITY CASCADE');
}

export async function tenant(prisma: PrismaService) {
  return prisma.tenant.create({ data: { name: 'Teste', trialEndsAt: new Date('2030-01-01') } });
}

let seq = 0;
export async function customer(prisma: PrismaService, tenantId: string, billingCycleDay = 1) {
  return prisma.customer.create({ data: { tenantId, name: `Cliente ${++seq} (dia ${billingCycleDay})`, billingCycleDay } });
}

export async function device(
  prisma: PrismaService,
  tenantId: string,
  customerId: string,
  host: string,
  extra: Partial<{
    billingExcluded: boolean;
    colorPagePriceOverride: number;
    minimumChargeOverride: number;
    manualBaselineDate: Date;
    manualBaselinePageCount: bigint;
  }> = {},
) {
  return prisma.device.create({ data: { tenantId, customerId, host, name: host, serialNumber: `SN-${host}`, ...extra } });
}

// One poll. mono/color given = the printer reports a split.
export async function reading(
  prisma: PrismaService,
  deviceId: string,
  at: string,
  pageCount: number,
  split?: { mono: number; color: number },
) {
  return prisma.metric.create({
    data: {
      deviceId,
      collectedAt: new Date(at),
      online: true,
      pageCount: BigInt(pageCount),
      ...(split ? { monoPageCount: BigInt(split.mono), colorPageCount: BigInt(split.color) } : {}),
    },
  });
}
