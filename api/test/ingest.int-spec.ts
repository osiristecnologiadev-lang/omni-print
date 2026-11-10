// What happens to an agent's readings in a real database: which printer
// they land on, when a new printer is created and how it starts out, and
// what is (and isn't) stored as a page reading.
import { connect, customer, reset, tenant } from './db';
import type { IngestMetricDto } from '../src/ingest/dto/ingest-payload.dto';

const { prisma, ingest } = connect();

beforeEach(() => reset(prisma));
afterAll(() => prisma.$disconnect());

function metric(over: Partial<IngestMetricDto> = {}): IngestMetricDto {
  return { device_name: 'IMP', host: '10.0.0.5', collected_at: new Date().toISOString(), online: true, ...over } as IngestMetricDto;
}

async function setup() {
  const t = await tenant(prisma);
  const c = await customer(prisma, t.id);
  return { t, c };
}

describe('Ingest (leituras do agente)', () => {
  it('creates a new printer for the agent token\'s customer, with brand and model', async () => {
    const { t, c } = await setup();
    await ingest.ingest(t.id, c.id, [
      metric({
        serial_number: 'PHBL12345',
        page_count: 12_345,
        model: 'HP LaserJet Pro M404dn',
        sys_object_id: '1.3.6.1.4.1.11.2.3.9.1',
        sys_descr: 'HP ETHERNET MULTI-ENVIRONMENT',
        printer_name: 'HPBFEAB2',
      }),
    ]);
    const d = await prisma.device.findFirstOrThrow({ where: { tenantId: t.id } });
    expect(d.customerId).toBe(c.id);
    expect(d.manufacturer).toBe('HP');
    expect(d.model).toBe('LaserJet Pro M404dn');
    expect(d.reviewPending).toBe(false);
    expect(d.billingExcluded).toBe(false);
    const m = await prisma.metric.findFirstOrThrow({ where: { deviceId: d.id } });
    expect(Number(m.pageCount)).toBe(12_345);
  });

  it('a printer found outside the agent network starts "fora do contrato" and to review', async () => {
    const { t, c } = await setup();
    await ingest.ingest(t.id, c.id, [metric({ serial_number: 'X1', page_count: 100, outside_agent_network: true })]);
    const d = await prisma.device.findFirstOrThrow({ where: { tenantId: t.id } });
    expect(d.reviewPending).toBe(true);
    expect(d.billingExcluded).toBe(true);
  });

  it('a new printer with no page counter yet starts to review (never billed blind)', async () => {
    const { t, c } = await setup();
    await ingest.ingest(t.id, c.id, [metric({ serial_number: 'X2' })]);
    const d = await prisma.device.findFirstOrThrow({ where: { tenantId: t.id } });
    expect(d.reviewPending).toBe(true);
  });

  it('a USB printer (host "USB:<pc>/<port>") is a normal printer, not to review', async () => {
    const { t, c } = await setup();
    await ingest.ingest(t.id, c.id, [
      metric({ host: 'USB:RECEPCAO-01/USB001', serial_number: 'CNB9K12345', page_count: 15_234, model: 'HP LaserJet Professional M1132 MFP' }),
    ]);
    const d = await prisma.device.findFirstOrThrow({ where: { tenantId: t.id } });
    expect(d.host).toBe('USB:RECEPCAO-01/USB001');
    expect(d.reviewPending).toBe(false);
    expect(d.manufacturer).toBe('HP');
  });

  it('the same serial at a new IP (DHCP) is the same printer, moved', async () => {
    const { t, c } = await setup();
    await ingest.ingest(t.id, c.id, [metric({ host: '10.0.0.5', serial_number: 'SAME', page_count: 1_000 })]);
    await ingest.ingest(t.id, c.id, [metric({ host: '10.0.0.99', serial_number: 'SAME', page_count: 1_050 })]);
    const all = await prisma.device.findMany({ where: { tenantId: t.id } });
    expect(all).toHaveLength(1);
    expect(all[0].host).toBe('10.0.0.99');
  });

  it('a different serial at an IP already used is a different printer (never merged)', async () => {
    const { t, c } = await setup();
    await ingest.ingest(t.id, c.id, [metric({ host: '10.0.0.5', serial_number: 'OLD', page_count: 90_000 })]);
    await ingest.ingest(t.id, c.id, [metric({ host: '10.0.0.5', serial_number: 'NEW', page_count: 10 })]);
    const all = await prisma.device.findMany({ where: { tenantId: t.id }, orderBy: { firstSeenAt: 'asc' } });
    expect(all.map((d) => d.serialNumber)).toEqual(['OLD', 'NEW']);
  });

  it('a 0 or missing counter, or an offline poll, is stored as "no reading" - not a fake zero', async () => {
    const { t, c } = await setup();
    await ingest.ingest(t.id, c.id, [
      metric({ serial_number: 'Z', page_count: 0 }),
      metric({ serial_number: 'Z', page_count: 5_000, online: false }),
    ]);
    const d = await prisma.device.findFirstOrThrow({ where: { tenantId: t.id } });
    const readings = await prisma.metric.findMany({ where: { deviceId: d.id } });
    expect(readings).toHaveLength(2);
    expect(readings.every((r) => r.pageCount === null)).toBe(true);
  });

  it('never moves an existing printer to another customer (a manual reassignment sticks)', async () => {
    const { t, c } = await setup();
    const other = await customer(prisma, t.id);
    await ingest.ingest(t.id, c.id, [metric({ serial_number: 'S', page_count: 1 })]);
    const d = await prisma.device.findFirstOrThrow({ where: { tenantId: t.id } });
    await prisma.device.update({ where: { id: d.id }, data: { customerId: other.id } });
    await ingest.ingest(t.id, c.id, [metric({ serial_number: 'S', page_count: 2 })]);
    expect((await prisma.device.findUniqueOrThrow({ where: { id: d.id } })).customerId).toBe(other.id);
  });

  it('an offline poll does not erase a known model', async () => {
    const { t, c } = await setup();
    await ingest.ingest(t.id, c.id, [metric({ serial_number: 'M', page_count: 1, model: 'ECOSYS M3655idn', sys_descr: 'KYOCERA Document Solutions' })]);
    await ingest.ingest(t.id, c.id, [metric({ serial_number: 'M', online: false, device_name: '10.0.0.5' })]);
    const d = await prisma.device.findFirstOrThrow({ where: { tenantId: t.id } });
    expect(d.manufacturer).toBe('Kyocera');
    expect(d.model).toBe('ECOSYS M3655idn');
  });
});
