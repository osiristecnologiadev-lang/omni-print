import { Test } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { TicketsService } from './tickets.service';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';

function makeTicket(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 't1',
    tenantId: 'tenant1',
    priority: 'MEDIUM',
    status: 'OPEN',
    resolvedAt: null,
    closedAt: null,
    assignedToUserId: null,
    ...overrides,
  };
}

describe('TicketsService.update', () => {
  let service: TicketsService;
  let prisma: {
    ticket: { findFirst: jest.Mock; update: jest.Mock };
    user: { findFirst: jest.Mock };
    tenant: { findUnique: jest.Mock };
  };
  let emailService: { send: jest.Mock };

  beforeEach(async () => {
    prisma = {
      ticket: { findFirst: jest.fn(), update: jest.fn((args) => args) },
      user: { findFirst: jest.fn() },
      // Off by default in these tests - only the dedicated "sends an
      // email on (re)assignment" tests below turn it on, so the other
      // (pre-existing) tests don't need to know or care that assignment
      // can now trigger an email.
      tenant: { findUnique: jest.fn().mockResolvedValue({ notifyEmailEnabled: false }) },
    };
    emailService = { send: jest.fn().mockResolvedValue(undefined) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        TicketsService,
        { provide: PrismaService, useValue: prisma },
        { provide: EmailService, useValue: emailService },
      ],
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

  it('assigning to someone new sends them an email when notifications are on', async () => {
    prisma.tenant.findUnique.mockResolvedValue({ notifyEmailEnabled: true });
    prisma.ticket.findFirst.mockResolvedValue(makeTicket({ subject: 'Toner acabou' }));
    prisma.user.findFirst.mockResolvedValue({ id: 'u1', email: 'staff@example.com', customerId: null, revokedAt: null });

    await callUpdate({ assignedToUserId: 'u1' });

    expect(emailService.send).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'staff@example.com', subject: expect.stringContaining('Toner acabou') }),
    );
  });

  it('re-assigning to the same person who already holds the ticket sends no email', async () => {
    prisma.tenant.findUnique.mockResolvedValue({ notifyEmailEnabled: true });
    prisma.ticket.findFirst.mockResolvedValue(makeTicket({ assignedToUserId: 'u1' }));
    prisma.user.findFirst.mockResolvedValue({ id: 'u1', email: 'staff@example.com', customerId: null, revokedAt: null });

    await callUpdate({ assignedToUserId: 'u1' });

    expect(emailService.send).not.toHaveBeenCalled();
  });

  it('assigning while notifications are off sends no email', async () => {
    prisma.tenant.findUnique.mockResolvedValue({ notifyEmailEnabled: false });
    prisma.ticket.findFirst.mockResolvedValue(makeTicket());
    prisma.user.findFirst.mockResolvedValue({ id: 'u1', email: 'staff@example.com', customerId: null, revokedAt: null });

    await callUpdate({ assignedToUserId: 'u1' });

    expect(emailService.send).not.toHaveBeenCalled();
  });
});

describe('TicketsService.addComment', () => {
  let service: TicketsService;
  let prisma: {
    ticket: { findFirst: jest.Mock; update: jest.Mock };
    ticketComment: { create: jest.Mock };
    user: { findMany: jest.Mock };
    tenant: { findUnique: jest.Mock };
  };
  let emailService: { send: jest.Mock };

  const baseTicket = {
    id: 't1',
    subject: 'Impressora travando',
    createdByUserId: 'creator1',
    createdByUser: { id: 'creator1', email: 'creator@example.com' },
    assignedToUserId: null as string | null,
    assignedToUser: null as { id: string; email: string } | null,
  };

  beforeEach(async () => {
    prisma = {
      ticket: { findFirst: jest.fn().mockResolvedValue(baseTicket), update: jest.fn() },
      ticketComment: { create: jest.fn().mockResolvedValue({ id: 'c1', body: 'oi', internal: false }) },
      user: { findMany: jest.fn().mockResolvedValue([]) },
      tenant: { findUnique: jest.fn().mockResolvedValue({ notifyEmailEnabled: true }) },
    };
    emailService = { send: jest.fn().mockResolvedValue(undefined) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        TicketsService,
        { provide: PrismaService, useValue: prisma },
        { provide: EmailService, useValue: emailService },
      ],
    }).compile();

    service = moduleRef.get(TicketsService);
  });

  it('rejects an internal note from a non-staff (customer-scoped) actor', async () => {
    await expect(
      service.addComment('tenant1', 'cust1', 't1', 'creator1', false, 'nota', true),
    ).rejects.toThrow(ForbiddenException);
    expect(prisma.ticketComment.create).not.toHaveBeenCalled();
  });

  it('allows an internal note from a staff actor and never emails the customer', async () => {
    prisma.ticketComment.create.mockResolvedValue({ id: 'c1', body: 'nota interna', internal: true });

    await service.addComment('tenant1', null, 't1', 'staff1', true, 'nota interna', true);

    expect(prisma.ticketComment.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ internal: true }) }),
    );
    expect(emailService.send).not.toHaveBeenCalled();
  });

  it('notifies the creator when someone else (the assignee) replies', async () => {
    prisma.ticket.findFirst.mockResolvedValue({
      ...baseTicket,
      assignedToUserId: 'assignee1',
      assignedToUser: { id: 'assignee1', email: 'assignee@example.com' },
    });

    await service.addComment('tenant1', null, 't1', 'assignee1', true, 'atualização', false);

    expect(emailService.send).toHaveBeenCalledWith(expect.objectContaining({ to: ['creator@example.com'] }));
  });

  it('notifies both creator and assignee when a third party (e.g. another staffer) replies', async () => {
    prisma.ticket.findFirst.mockResolvedValue({
      ...baseTicket,
      assignedToUserId: 'assignee1',
      assignedToUser: { id: 'assignee1', email: 'assignee@example.com' },
    });

    await service.addComment('tenant1', null, 't1', 'other-staffer', true, 'atualização', false);

    const call = emailService.send.mock.calls[0][0];
    expect(new Set(call.to)).toEqual(new Set(['creator@example.com', 'assignee@example.com']));
  });

  it('does not email the actor about their own comment', async () => {
    await service.addComment('tenant1', null, 't1', 'creator1', true, 'só eu por aqui', false);

    expect(emailService.send).not.toHaveBeenCalled();
  });

  it('falls back to all tenant-wide staff with the tickets permission when no creator/assignee is left to notify', async () => {
    prisma.user.findMany.mockResolvedValue([{ email: 'a@example.com' }, { email: 'b@example.com' }]);

    // Actor is the creator themself and there's no assignee yet - nobody
    // distinct to notify directly.
    await service.addComment('tenant1', 'cust1', 't1', 'creator1', false, 'alguém aí?', false);

    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId: 'tenant1', customerId: null, permissions: { has: 'tickets' } }),
      }),
    );
    const call = emailService.send.mock.calls[0][0];
    expect(new Set(call.to)).toEqual(new Set(['a@example.com', 'b@example.com']));
  });

  it('sends no email at all when notifications are disabled for the tenant', async () => {
    prisma.tenant.findUnique.mockResolvedValue({ notifyEmailEnabled: false });
    prisma.ticket.findFirst.mockResolvedValue({
      ...baseTicket,
      assignedToUserId: 'assignee1',
      assignedToUser: { id: 'assignee1', email: 'assignee@example.com' },
    });

    await service.addComment('tenant1', null, 't1', 'other-staffer', true, 'atualização', false);

    expect(emailService.send).not.toHaveBeenCalled();
  });
});

describe('TicketsService.slaBreached', () => {
  it('queries unresolved tickets whose SLA deadline has already passed, oldest breach first', async () => {
    const prisma = {
      ticket: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        TicketsService,
        { provide: PrismaService, useValue: prisma },
        { provide: EmailService, useValue: { send: jest.fn() } },
      ],
    }).compile();
    const service = moduleRef.get(TicketsService);

    await service.slaBreached('tenant1');

    expect(prisma.ticket.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: 'tenant1',
          status: { notIn: ['RESOLVED', 'CLOSED'] },
          slaDueAt: { lt: expect.any(Date) },
        }),
        orderBy: { slaDueAt: 'asc' },
      }),
    );
  });
});

describe('TicketsService.getAttachmentForDownload', () => {
  let service: TicketsService;
  let prisma: {
    ticket: { findFirst: jest.Mock };
    ticketAttachment: { findFirst: jest.Mock };
    ticketComment: { findUnique: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      ticket: { findFirst: jest.fn().mockResolvedValue({ id: 't1' }) },
      ticketAttachment: { findFirst: jest.fn() },
      ticketComment: { findUnique: jest.fn() },
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        TicketsService,
        { provide: PrismaService, useValue: prisma },
        { provide: EmailService, useValue: { send: jest.fn() } },
      ],
    }).compile();
    service = moduleRef.get(TicketsService);
  });

  it('lets a tenant-wide (staff) caller download an attachment from an internal comment', async () => {
    prisma.ticketAttachment.findFirst.mockResolvedValue({ id: 'att1', commentId: 'c1' });
    prisma.ticketComment.findUnique.mockResolvedValue({ internal: true });

    const attachment = await service.getAttachmentForDownload('tenant1', null, 't1', 'att1');

    expect(attachment.id).toBe('att1');
    expect(prisma.ticketComment.findUnique).not.toHaveBeenCalled();
  });

  it('blocks a customer-scoped caller from downloading an attachment on an internal-only comment', async () => {
    prisma.ticketAttachment.findFirst.mockResolvedValue({ id: 'att1', commentId: 'c1' });
    prisma.ticketComment.findUnique.mockResolvedValue({ internal: true });

    await expect(service.getAttachmentForDownload('tenant1', 'cust1', 't1', 'att1')).rejects.toThrow(NotFoundException);
  });

  it('lets a customer-scoped caller download an attachment on a public comment', async () => {
    prisma.ticketAttachment.findFirst.mockResolvedValue({ id: 'att1', commentId: 'c1' });
    prisma.ticketComment.findUnique.mockResolvedValue({ internal: false });

    const attachment = await service.getAttachmentForDownload('tenant1', 'cust1', 't1', 'att1');

    expect(attachment.id).toBe('att1');
  });

  it('lets a customer-scoped caller download a ticket-level attachment (no parent comment) without an extra lookup', async () => {
    prisma.ticketAttachment.findFirst.mockResolvedValue({ id: 'att1', commentId: null });

    const attachment = await service.getAttachmentForDownload('tenant1', 'cust1', 't1', 'att1');

    expect(attachment.id).toBe('att1');
    expect(prisma.ticketComment.findUnique).not.toHaveBeenCalled();
  });
});
