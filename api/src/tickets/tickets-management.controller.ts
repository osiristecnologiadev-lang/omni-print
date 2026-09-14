import { Body, Controller, Get, Param, Patch, Query, Req, UseGuards } from '@nestjs/common';
import { TicketStatus } from '@prisma/client';
import { UserAuthGuard } from '../auth/user-auth.guard';
import { SubscriptionGuard } from '../subscription/subscription.guard';
import { assertPermission } from '../auth/permissions.util';
import { AuditLogService } from '../audit-log/audit-log.service';
import { TicketsService } from './tickets.service';
import { UpdateTicketDto } from './dto/update-ticket.dto';

// Tenant-wide-only surface (unlike TicketsController, which both sides use)
// - the staff queue view across every customer at once, and the actions
// only staff should take (change status/priority, assign).
@UseGuards(UserAuthGuard, SubscriptionGuard)
@Controller('v1/tickets')
export class TicketsManagementController {
  constructor(
    private readonly ticketsService: TicketsService,
    private readonly auditLog: AuditLogService,
  ) {}

  @Get()
  list(@Req() req: any, @Query('status') status?: TicketStatus) {
    assertPermission(req, 'tickets');
    return this.ticketsService.list(req.tenantId, null, status);
  }

  // Lets the frontend's flat /tickets/:id route fetch a ticket without
  // already knowing which customer it belongs to (TicketsController's own
  // GET needs customerId in the path) - customerId: null here means "any
  // customer of this tenant," same as list() above.
  @Get(':id')
  get(@Req() req: any, @Param('id') id: string) {
    assertPermission(req, 'tickets');
    return this.ticketsService.get(req.tenantId, null, id);
  }

  @Patch(':id')
  async update(@Req() req: any, @Param('id') id: string, @Body() dto: UpdateTicketDto) {
    assertPermission(req, 'tickets');
    const ticket = await this.ticketsService.update(req.tenantId, id, dto);
    await this.auditLog.log({
      tenantId: req.tenantId,
      actorType: 'USER',
      actorId: req.userId,
      actorLabel: req.userEmail,
      action: 'ticket.update',
      targetType: 'Ticket',
      targetId: ticket.id,
      targetLabel: ticket.subject,
      metadata: dto as Record<string, unknown>,
    });
    return ticket;
  }
}
