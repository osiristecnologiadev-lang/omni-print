import { Test } from '@nestjs/testing';
import { IngestService } from './ingest.service';
import { PrismaService } from '../prisma/prisma.service';
import type { IngestMetricDto } from './dto/ingest-payload.dto';

// Regression coverage for a real bug found this session: a physical
// printer swap at the same IP (old unit removed, a different one
// configured with the same host) was silently merging the new device's
// data into the OLD device's row via the host-matching fallback - see
// IngestService.upsertDevice's comment for the full story.

function baseMetric(overrides: Partial<IngestMetricDto> = {}): IngestMetricDto {
  return {
    device_name: 'Printer',
    host: '10.0.0.50',
    collected_at: '2026-09-01T10:00:00Z',
    online: true,
    ...overrides,
  } as IngestMetricDto;
}

describe('IngestService.upsertDevice (via ingest)', () => {
  let service: IngestService;
  let prisma: {
    device: {
      findUnique: jest.Mock;
      findFirst: jest.Mock;
      update: jest.Mock;
      create: jest.Mock;
    };
    metric: { create: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      device: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
        create: jest.fn(),
      },
      metric: { create: jest.fn() },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [IngestService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = moduleRef.get(IngestService);
  });

  it('creates a new device when a new serial appears at a host already used by a different serial', async () => {
    const oldDevice = { id: 'old-device-id', tenantId: 't1', serialNumber: 'OLD-SERIAL', host: '10.0.0.50' };
    prisma.device.findUnique.mockResolvedValue(null); // new serial, not seen before
    prisma.device.findFirst.mockResolvedValue(oldDevice); // but this host has a device already
    prisma.device.create.mockResolvedValue({ id: 'new-device-id' });
    prisma.metric.create.mockResolvedValue({});

    await service.ingest('t1', null, [baseMetric({ serial_number: 'NEW-SERIAL' })]);

    // Must create a fresh device, never update/overwrite the old one.
    expect(prisma.device.update).not.toHaveBeenCalled();
    expect(prisma.device.create).toHaveBeenCalledTimes(1);
    const createArg = prisma.device.create.mock.calls[0][0];
    expect(createArg.data.serialNumber).toBe('NEW-SERIAL');
    expect(createArg.data.tenantId).toBe('t1');
  });

  it('reuses the existing device when the host has no serial yet (still being identified)', async () => {
    const existing = { id: 'existing-id', tenantId: 't1', serialNumber: null, host: '10.0.0.50' };
    prisma.device.findUnique.mockResolvedValue(null);
    prisma.device.findFirst.mockResolvedValue(existing);
    prisma.device.update.mockResolvedValue({ id: 'existing-id' });
    prisma.metric.create.mockResolvedValue({});

    await service.ingest('t1', null, [baseMetric({ serial_number: 'FIRST-SERIAL' })]);

    expect(prisma.device.create).not.toHaveBeenCalled();
    expect(prisma.device.update).toHaveBeenCalledWith({
      where: { id: 'existing-id' },
      data: expect.objectContaining({ serialNumber: 'FIRST-SERIAL' }),
    });
  });

  it('reuses the existing device when this poll has no serial at all (transient read failure, not a swap)', async () => {
    const existing = { id: 'existing-id', tenantId: 't1', serialNumber: 'KNOWN-SERIAL', host: '10.0.0.50' };
    prisma.device.findFirst.mockResolvedValue(existing);
    prisma.device.update.mockResolvedValue({ id: 'existing-id' });
    prisma.metric.create.mockResolvedValue({});

    // No serial_number in this poll at all.
    await service.ingest('t1', null, [baseMetric()]);

    expect(prisma.device.findUnique).not.toHaveBeenCalled(); // no serial to look up by
    expect(prisma.device.create).not.toHaveBeenCalled();
    expect(prisma.device.update).toHaveBeenCalledWith({
      where: { id: 'existing-id' },
      data: expect.objectContaining({ host: '10.0.0.50' }),
    });
  });

  it('reuses the existing device when the serial already matches (normal repeated poll)', async () => {
    const existing = { id: 'existing-id', tenantId: 't1', serialNumber: 'SAME-SERIAL', host: '10.0.0.50' };
    prisma.device.findUnique.mockResolvedValue(existing); // direct serial match
    prisma.device.update.mockResolvedValue({ id: 'existing-id' });
    prisma.metric.create.mockResolvedValue({});

    await service.ingest('t1', null, [baseMetric({ serial_number: 'SAME-SERIAL' })]);

    expect(prisma.device.findFirst).not.toHaveBeenCalled(); // found directly by serial, no host fallback needed
    expect(prisma.device.create).not.toHaveBeenCalled();
    expect(prisma.device.update).toHaveBeenCalledWith({ where: { id: 'existing-id' }, data: expect.anything() });
  });
});
