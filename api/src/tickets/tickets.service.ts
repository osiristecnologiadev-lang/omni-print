import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { TicketStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { computeSlaDueAt } from '../common/sla.util';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { UpdateTicketDto } from './dto/update-ticket.dto';

const TICKET_INCLUDE = {
  customer: { select: { id: true, name: true } },
  device: { select: { id: true, name: true, printerName: true, customLabel: true, host: true } },
  createdByUser: { select: { id: true, name: true, email: true } },
  assignedToUser: { select: { id: true, name: true, email: true } },
} as const;

@Injectable()
export class TicketsService {
  constructor(private readonly prisma: PrismaService) {}

  private async requireCustomer(tenantId: string, customerId: string) {
    const customer = await this.prisma.customer.findFirst({ where: { id: customerId, tenantId } });
    if (!customer) {
      throw new NotFoundException('customer not found');
    }
    return customer;
  }

  // Opening a ticket is the one place in this app a customer-scoped user
  // creates data rather than just reading it - see the Ticket model's
  // schema comment.
  async create(tenantId: string, customerId: string, actorUserId: string, dto: CreateTicketDto) {
    const customer = await this.requireCustomer(tenantId, customerId);

    if (dto.deviceId) {
      const device = await this.prisma.device.findFirst({ where: { id: dto.deviceId, tenantId, customerId } });
      if (!device) {
        throw new NotFoundException('device not found for this customer');
      }
    }

    const priority = dto.priority ?? 'MEDIUM';
    const now = new Date();

    return this.prisma.ticket.create({
      data: {
        tenantId,
        customerId,
        deviceId: dto.deviceId ?? null,
        subject: dto.subject,
        description: dto.description,
        priority,
        createdByUserId: actorUserId,
        slaDueAt: computeSlaDueAt(priority, now, customer),
      },
      include: TICKET_INCLUDE,
    });
  }

  // customerId null (tenant-wide caller) sees every customer's tickets;
  // set (customer-scoped caller) sees only their own - same pattern as
  // DevicesService's list methods.
  async list(tenantId: string, customerId: string | null, status?: TicketStatus) {
    return this.prisma.ticket.findMany({
      where: {
        tenantId,
        ...(customerId ? { customerId } : {}),
        ...(status ? { status } : {}),
      },
      include: TICKET_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
  }

  async get(tenantId: string, customerId: string | null, ticketId: string) {
    const ticket = await this.prisma.ticket.findFirst({
      where: { id: ticketId, tenantId, ...(customerId ? { customerId } : {}) },
      include: {
        ...TICKET_INCLUDE,
        comments: {
          orderBy: { createdAt: 'asc' },
          include: { authorUser: { select: { id: true, name: true, email: true } } },
        },
      },
    });
    if (!ticket) {
      throw new NotFoundException('ticket not found');
    }
    return ticket;
  }

  async addComment(tenantId: string, customerId: string | null, ticketId: string, actorUserId: string, body: string) {
    // Reuses get's scoping so a customer-scoped user can't comment on
    // another customer's ticket - findFirst returning nothing IS the access
    // check, not just a lookup.
    await this.get(tenantId, customerId, ticketId);

    const comment = await this.prisma.ticketComment.create({
      data: { ticketId, authorUserId: actorUserId, body },
      include: { authorUser: { select: { id: true, name: true, email: true } } },
    });
    // TicketComment is a separate table - creating one doesn't touch the
    // parent Ticket row, so its own @updatedAt wouldn't otherwise reflect
    // new activity. Bumped explicitly so "most recently active ticket"
    // sorting/display stays meaningful.
    await this.prisma.ticket.update({ where: { id: ticketId }, data: { updatedAt: new Date() } });
    return comment;
  }

  // Staff-only (status/priority/assignment) - enforced by the controller's
  // tenant-wide guard, not repeated here, same convention as
  // DevicesService.update.
  async update(tenantId: string, ticketId: string, dto: UpdateTicketDto) {
    const ticket = await this.prisma.ticket.findFirst({
      where: { id: ticketId, tenantId },
      include: { customer: true },
    });
    if (!ticket) {
      throw new NotFoundException('ticket not found');
    }

    const data: Record<string, unknown> = {};
    const now = new Date();

    if (dto.assignedToUserId !== undefined) {
      if (dto.assignedToUserId) {
        // Only a tenant-wide staff user (customerId null) is a valid
        // assignee - there's no one on the customer's own side to route a
        // ticket to.
        const assignee = await this.prisma.user.findFirst({
          where: { id: dto.assignedToUserId, tenantId, customerId: null, revokedAt: null },
        });
        if (!assignee) {
          throw new NotFoundException('assignee not found (must be an active tenant-wide user)');
        }
      }
      data.assignedToUserId = dto.assignedToUserId;
    }

    if (dto.priority !== undefined && dto.priority !== ticket.priority) {
      data.priority = dto.priority;
      // A priority change re-promises a new deadline from right now -
      // see sla.util.ts's comment on why slaDueAt is stored, not derived.
      data.slaDueAt = computeSlaDueAt(dto.priority, now, ticket.customer);
    }

    if (dto.status !== undefined) {
      const settled = dto.status === 'RESOLVED' || dto.status === 'CLOSED';
      if (settled) {
        if (!ticket.resolvedAt) {
          data.resolvedAt = now;
        }
        if (dto.status === 'CLOSED') {
          data.closedAt = now;
        }
      } else {
        // Reopening - a ticket that was resolved/closed and is now back in
        // play shouldn't still claim it was resolved/closed.
        data.resolvedAt = null;
        data.closedAt = null;
      }
      data.status = dto.status;
    }

    return this.prisma.ticket.update({ where: { id: ticketId }, data, include: TICKET_INCLUDE });
  }

  assertTenantWide(customerId: string | null) {
    if (customerId) {
      throw new ForbiddenException('only tenant-wide users can do this');
    }
  }
}
