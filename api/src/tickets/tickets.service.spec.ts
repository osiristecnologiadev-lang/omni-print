import { Test } from '@nestjs/testing';
import { TicketsService } from './tickets.service';
import { PrismaService } from '../prisma/prisma.service';

function makeTicket(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 't1',
    tenantId: 'tenant1',
    priority: 'MEDIUM',
    status: 'OPEN',
    resolvedAt: null,
    closedAt: null,
    ...overrides,
  };
}

describe('TicketsService.update', () => {
  let service: TicketsService;
  let prisma: {
    ticket: { findFirst: jest.Mock; update: jest.Mock };
    user: { findFirst: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      ticket: { findFirst: jest.fn(), update: jest.fn((args) => args) },
      user: { findFirst: jest.fn() },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [TicketsService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = moduleRef.get(TicketsService);
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-09-03T12:00:00Z'));
  });

  afterEach(() => jest.useRealTimers());

  async function callUpdate(dto: Record<string, unknown>): Promise<{ data: Record<string, unknown> }> {
    return (await service.update('tenant1', 't1', dto as never)) as unknown as { data: Record<string, unknown> };
  }

  it('setting status to RESOLVED sets resolvedAt but not closedAt', async () => {
    prisma.ticket.findFirst.mockResolvedValue(makeTicket());

    const { data } = await callUpdate({ status: 'RESOLVED' });

    expect(data.status).toBe('RESOLVED');
    expect(data.resolvedAt).toEqual(new Date('2026-09-03T12:00:00Z'));
    expect(data.closedAt).toBeUndefined();
  });

  it('setting status to CLOSED sets both resolvedAt and closedAt when neither was set', async () => {
    prisma.ticket.findFirst.mockResolvedValue(makeTicket());

    const { data } = await callUpdate({ status: 'CLOSED' });

    expect(data.resolvedAt).toEqual(new Date('2026-09-03T12:00:00Z'));
    expect(data.closedAt).toEqual(new Date('2026-09-03T12:00:00Z'));
  });

  it('closing an already-resolved ticket keeps the original resolvedAt, only sets closedAt', async () => {
    const originalResolvedAt = new Date('2026-09-01T00:00:00Z');
    prisma.ticket.findFirst.mockResolvedValue(makeTicket({ status: 'RESOLVED', resolvedAt: originalResolvedAt }));

    const { data } = await callUpdate({ status: 'CLOSED' });

    expect(data.resolvedAt).toBeUndefined(); // not touched - stays whatever it already was
    expect(data.closedAt).toEqual(new Date('2026-09-03T12:00:00Z'));
  });

  it('reopening a resolved ticket clears resolvedAt and closedAt', async () => {
    prisma.ticket.findFirst.mockResolvedValue(
      makeTicket({ status: 'RESOLVED', resolvedAt: new Date('2026-09-01T00:00:00Z') }),
    );

    const { data } = await callUpdate({ status: 'IN_PROGRESS' });

    expect(data.status).toBe('IN_PROGRESS');
    expect(data.resolvedAt).toBeNull();
    expect(data.closedAt).toBeNull();
  });

  it('changing priority recomputes slaDueAt from now, not from the original createdAt', async () => {
    prisma.ticket.findFirst.mockResolvedValue(makeTicket({ priority: 'MEDIUM' }));

    const { data } = await callUpdate({ priority: 'URGENT' });

    expect(data.priority).toBe('URGENT');
    expect(data.slaDueAt).toEqual(new Date('2026-09-03T16:00:00Z')); // +4h URGENT threshold from fake "now"
  });

  it('uses the ticket customer\'s SLA override instead of the global default when set', async () => {
    prisma.ticket.findFirst.mockResolvedValue(
      makeTicket({ priority: 'MEDIUM', customer: { slaHoursUrgent: 2 } }),
    );

    const { data } = await callUpdate({ priority: 'URGENT' });

    expect(data.slaDueAt).toEqual(new Date('2026-09-03T14:00:00Z')); // +2h override, not the +4h global default
  });

  it('setting priority to the same value it already has does not touch slaDueAt', async () => {
    prisma.ticket.findFirst.mockResolvedValue(makeTicket({ priority: 'MEDIUM' }));

    const { data } = await callUpdate({ priority: 'MEDIUM' });

    expect(data.priority).toBeUndefined();
    expect(data.slaDueAt).toBeUndefined();
  });

  it('assigning to a valid active tenant-wide user succeeds', async () => {
    prisma.ticket.findFirst.mockResolvedValue(makeTicket());
    prisma.user.findFirst.mockResolvedValue({ id: 'u1', customerId: null, revokedAt: null });

    const { data } = await callUpdate({ assignedToUserId: 'u1' });

    expect(data.assignedToUserId).toBe('u1');
    expect(prisma.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: 'u1', tenantId: 'tenant1', customerId: null }) }),
    );
  });

  it('assigning to a nonexistent/customer-scoped/revoked user throws', async () => {
    prisma.ticket.findFirst.mockResolvedValue(makeTicket());
    prisma.user.findFirst.mockResolvedValue(null);

    await expect(callUpdate({ assignedToUserId: 'bad-user' })).rejects.toThrow();
  });

  it('unassigning (null) does not look up a user at all', async () => {
    prisma.ticket.findFirst.mockResolvedValue(makeTicket({ assignedToUserId: 'u1' }));

    const { data } = await callUpdate({ assignedToUserId: null });

    expect(data.assignedToUserId).toBeNull();
    expect(prisma.user.findFirst).not.toHaveBeenCalled();
  });

  it('throws NotFoundException when the ticket does not belong to this tenant', async () => {
    prisma.ticket.findFirst.mockResolvedValue(null);

    await expect(callUpdate({ status: 'RESOLVED' })).rejects.toThrow();
  });
});
