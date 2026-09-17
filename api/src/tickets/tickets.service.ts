import { randomUUID } from 'crypto';
import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { TicketStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { computeSlaDueAt, TicketPriorityKey } from '../common/sla.util';
import { escapeHtml } from '../common/html.util';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { UpdateTicketDto } from './dto/update-ticket.dto';

// Same local-disk-under-storage/ posture as AgentReleasesService's
// STORAGE_ROOT (see that file's comment) - lives on the same persistent
// Railway volume mounted at /app/storage, so it survives redeploys.
const STORAGE_ROOT = join(process.cwd(), 'storage', 'ticket-attachments');
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
// Jam photos and error-screen screenshots are the realistic use case (see
// the UX-audit finding this closes) - deliberately not "any file", to
// avoid this becoming an arbitrary-file-upload surface.
export const ALLOWED_ATTACHMENT_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'];

const PERSON_SELECT = { select: { id: true, name: true, email: true } } as const;
const ATTACHMENT_INCLUDE = {
  orderBy: { createdAt: 'asc' as const },
  include: { uploadedByUser: PERSON_SELECT },
};

const TICKET_INCLUDE = {
  customer: { select: { id: true, name: true } },
  device: { select: { id: true, name: true, printerName: true, customLabel: true, host: true } },
  createdByUser: PERSON_SELECT,
  assignedToUser: PERSON_SELECT,
} as const;

@Injectable()
export class TicketsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
  ) {}

  private async requireCustomer(tenantId: string, customerId: string) {
    const customer = await this.prisma.customer.findFirst({ where: { id: customerId, tenantId } });
    if (!customer) {
      throw new NotFoundException('customer not found');
    }
    return customer;
  }

  // A lighter lookup than get() below - just enough to check scope and to
  // notify the right people, without pulling the whole comment/attachment
  // thread for every comment/update call.
  private async requireTicketForActor(tenantId: string, customerId: string | null, ticketId: string) {
    const ticket = await this.prisma.ticket.findFirst({
      where: { id: ticketId, tenantId, ...(customerId ? { customerId } : {}) },
      select: {
        id: true,
        subject: true,
        createdByUserId: true,
        createdByUser: { select: { id: true, email: true } },
        assignedToUserId: true,
        assignedToUser: { select: { id: true, email: true } },
      },
    });
    if (!ticket) {
      throw new NotFoundException('ticket not found');
    }
    return ticket;
  }

  // Opening a ticket is the one place in this app a customer-scoped user
  // creates data rather than just reading it - see the Ticket model's
  // schema comment.
  async create(tenantId: string, customerId: string, actorUserId: string, dto: CreateTicketDto, file?: Express.Multer.File) {
    const customer = await this.requireCustomer(tenantId, customerId);

    if (dto.deviceId) {
      const device = await this.prisma.device.findFirst({ where: { id: dto.deviceId, tenantId, customerId } });
      if (!device) {
        throw new NotFoundException('device not found for this customer');
      }
    }

    const priority = dto.priority ?? 'MEDIUM';
    const now = new Date();

    const ticket = await this.prisma.ticket.create({
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

    if (file) {
      await this.saveAttachment(ticket.id, null, actorUserId, file);
    }

    return ticket;
  }

  // The system-opened equivalent of create() above - no actorUserId at all
  // (createdByUserId is left null, see the schema comment on
  // Ticket.createdByUserId), called only from
  // NotificationsService.autoCreateTickets. deviceId is only ever set for
  // the two device-rooted alert types (CRITICAL_DEVICE_ALERT/LOW_SUPPLY) -
  // left null for the others (e.g. an overdue invoice isn't about any one
  // printer).
  async createAutomated(
    tenantId: string,
    customerId: string,
    input: { subject: string; description: string; deviceId?: string | null; priority: TicketPriorityKey },
  ) {
    const customer = await this.requireCustomer(tenantId, customerId);
    const now = new Date();

    return this.prisma.ticket.create({
      data: {
        tenantId,
        customerId,
        deviceId: input.deviceId ?? null,
        subject: input.subject,
        description: input.description,
        priority: input.priority,
        createdByUserId: null,
        slaDueAt: computeSlaDueAt(input.priority, now, customer),
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
        // Ticket-level (commentId null - attached at creation time,
        // alongside `description`) - never internal, always visible.
        attachments: { where: { commentId: null }, ...ATTACHMENT_INCLUDE },
        comments: {
          orderBy: { createdAt: 'asc' },
          include: { authorUser: PERSON_SELECT, attachments: ATTACHMENT_INCLUDE },
        },
      },
    });
    if (!ticket) {
      throw new NotFoundException('ticket not found');
    }
    // A customer-scoped caller never sees a staff-only internal note - see
    // the schema comment on TicketComment.internal. Filtered here (not in
    // the query itself) so a tenant-wide caller reusing this same method
    // still gets everything.
    if (customerId) {
      ticket.comments = ticket.comments.filter((c) => !c.internal);
    }
    return ticket;
  }

  async addComment(
    tenantId: string,
    customerId: string | null,
    ticketId: string,
    actorUserId: string,
    actorIsStaff: boolean,
    body: string,
    internal: boolean,
    file?: Express.Multer.File,
  ) {
    const ticket = await this.requireTicketForActor(tenantId, customerId, ticketId);
    if (internal && !actorIsStaff) {
      // Belt and suspenders - the frontend never renders this control for a
      // customer-scoped session, but the API itself must not trust that.
      throw new ForbiddenException('only staff can post an internal note');
    }

    const comment = await this.prisma.ticketComment.create({
      data: { ticketId, authorUserId: actorUserId, body, internal },
      include: { authorUser: PERSON_SELECT },
    });

    if (file) {
      await this.saveAttachment(ticketId, comment.id, actorUserId, file);
    }

    // TicketComment is a separate table - creating one doesn't touch the
    // parent Ticket row, so its own @updatedAt wouldn't otherwise reflect
    // new activity. Bumped explicitly so "most recently active ticket"
    // sorting/display stays meaningful.
    await this.prisma.ticket.update({ where: { id: ticketId }, data: { updatedAt: new Date() } });

    // Internal notes are staff-only by definition - never worth emailing
    // anyone about, and specifically must never reach the customer.
    if (!internal) {
      await this.notifyNewComment(tenantId, ticket, actorUserId);
    }

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
    let newAssignee: { id: string; email: string } | null = null;

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
        if (assignee.id !== ticket.assignedToUserId) {
          newAssignee = assignee;
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

    const updated = await this.prisma.ticket.update({ where: { id: ticketId }, data, include: TICKET_INCLUDE });

    if (newAssignee) {
      await this.notifyAssigned(tenantId, ticket.id, ticket.subject, newAssignee.email);
    }

    return updated;
  }

  // Unresolved (open/in-progress) tickets whose promised response time has
  // already passed - fed into NotificationsService's daily digest as
  // TICKET_SLA_BREACH. Mirrors InvoicesService.alerts' shape (a plain,
  // service-owned query) rather than making NotificationsService reach
  // into Prisma directly for a different module's table.
  slaBreached(tenantId: string) {
    return this.prisma.ticket.findMany({
      where: { tenantId, status: { notIn: ['RESOLVED', 'CLOSED'] }, slaDueAt: { lt: new Date() } },
      select: { id: true, subject: true, slaDueAt: true, customerId: true, customer: { select: { name: true } } },
      orderBy: { slaDueAt: 'asc' },
    });
  }

  async getAttachmentForDownload(tenantId: string, customerId: string | null, ticketId: string, attachmentId: string) {
    const ticket = await this.prisma.ticket.findFirst({
      where: { id: ticketId, tenantId, ...(customerId ? { customerId } : {}) },
      select: { id: true },
    });
    if (!ticket) {
      throw new NotFoundException('ticket not found');
    }

    const attachment = await this.prisma.ticketAttachment.findFirst({ where: { id: attachmentId, ticketId } });
    if (!attachment) {
      throw new NotFoundException('attachment not found');
    }

    // A customer-scoped caller must never reach a file that only exists
    // because of an internal-only comment, even by guessing the
    // attachment id directly - re-check via the parent comment, since the
    // scope check above only confirmed the *ticket* (not this specific
    // attachment) belongs to them.
    if (customerId && attachment.commentId) {
      const comment = await this.prisma.ticketComment.findUnique({
        where: { id: attachment.commentId },
        select: { internal: true },
      });
      if (comment?.internal) {
        throw new NotFoundException('attachment not found');
      }
    }

    return attachment;
  }

  private async saveAttachment(ticketId: string, commentId: string | null, uploadedByUserId: string, file: Express.Multer.File) {
    if (!ALLOWED_ATTACHMENT_MIME_TYPES.includes(file.mimetype)) {
      throw new BadRequestException('unsupported file type - only images and PDF are allowed');
    }

    const dir = join(STORAGE_ROOT, ticketId);
    await mkdir(dir, { recursive: true });
    // Server-generated name, never the client-supplied filename - avoids
    // any path-traversal/collision risk from an untrusted original name
    // while still keeping the human-readable `filename` column for display.
    const storedPath = join(dir, `${randomUUID()}${extname(file.originalname)}`);
    await writeFile(storedPath, file.buffer);

    return this.prisma.ticketAttachment.create({
      data: {
        ticketId,
        commentId,
        uploadedByUserId,
        filename: file.originalname,
        storedPath,
        sizeBytes: file.size,
        mimeType: file.mimetype,
      },
    });
  }

  private async emailEnabled(tenantId: string): Promise<boolean> {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { notifyEmailEnabled: true } });
    return tenant?.notifyEmailEnabled ?? false;
  }

  private async notifyNewComment(
    tenantId: string,
    ticket: {
      id: string;
      subject: string;
      createdByUserId: string | null;
      createdByUser: { id: string; email: string } | null;
      assignedToUserId: string | null;
      assignedToUser: { id: string; email: string } | null;
    },
    actorUserId: string,
  ): Promise<void> {
    if (!(await this.emailEnabled(tenantId))) return;

    const recipients = new Set<string>();
    // createdByUserId is null for a system-opened ticket (see the schema
    // comment) - nothing to notify there, falls through to the
    // no-distinct-recipient staff-fallback below same as any other ticket
    // with no one specific to reach yet.
    if (ticket.createdByUserId && ticket.createdByUserId !== actorUserId) recipients.add(ticket.createdByUser!.email);
    if (ticket.assignedToUserId && ticket.assignedToUserId !== actorUserId) recipients.add(ticket.assignedToUser!.email);

    if (recipients.size === 0) {
      // No one distinct to notify directly - e.g. the customer replying on
      // their own still-unassigned ticket. Fall back to every tenant-wide
      // staff member who can see the queue, so a reply never goes
      // unnoticed just because no one's been assigned yet.
      const staff = await this.prisma.user.findMany({
        where: { tenantId, customerId: null, revokedAt: null, permissions: { has: 'tickets' } },
        select: { email: true },
      });
      staff.forEach((s) => recipients.add(s.email));
    }
    if (recipients.size === 0) return;

    const appUrl = process.env.APP_URL ?? 'http://localhost:3001';
    await this.emailService.send({
      to: [...recipients],
      subject: `OmniPrint: novo comentário em "${ticket.subject}"`,
      html: `<p style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;">Novo comentário no chamado <strong>${escapeHtml(ticket.subject)}</strong>.</p><p style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;"><a href="${appUrl}/tickets/${ticket.id}" style="color:#2547d0;">Ver chamado →</a></p>`,
      text: `Novo comentário no chamado "${ticket.subject}".\nVer: ${appUrl}/tickets/${ticket.id}`,
    });
  }

  private async notifyAssigned(tenantId: string, ticketId: string, subject: string, assigneeEmail: string): Promise<void> {
    if (!(await this.emailEnabled(tenantId))) return;

    const appUrl = process.env.APP_URL ?? 'http://localhost:3001';
    await this.emailService.send({
      to: assigneeEmail,
      subject: `OmniPrint: chamado atribuído a você - "${subject}"`,
      html: `<p style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;">O chamado <strong>${escapeHtml(subject)}</strong> foi atribuído a você.</p><p style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;"><a href="${appUrl}/tickets/${ticketId}" style="color:#2547d0;">Ver chamado →</a></p>`,
      text: `O chamado "${subject}" foi atribuído a você.\nVer: ${appUrl}/tickets/${ticketId}`,
    });
  }
}

function extname(filename: string): string {
  const i = filename.lastIndexOf('.');
  // Only keep a short, plain extension (letters/digits, <=5 chars) - the
  // original filename is untrusted input and this is used to build a path
  // on disk.
  if (i === -1) return '';
  const ext = filename.slice(i);
  return /^\.[A-Za-z0-9]{1,5}$/.test(ext) ? ext : '';
}
