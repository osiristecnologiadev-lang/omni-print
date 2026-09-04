import { Body, Controller, Get, Param, Patch, Query, Req, UseGuards } from '@nestjs/common';
import { TicketStatus } from '@prisma/client';
import { UserAuthGuard } from '../auth/user-auth.guard';
import { TicketsService } from './tickets.service';
import { UpdateTicketDto } from './dto/update-ticket.dto';

// Tenant-wide-only surface (unlike TicketsController, which both sides use)
// - the staff queue view across every customer at once, and the actions
// only staff should take (change status/priority, assign).
@UseGuards(UserAuthGuard)
@Controller('v1/tickets')
export class TicketsManagementController {
  constructor(private readonly ticketsService: TicketsService) {}

  @Get()
  list(@Req() req: any, @Query('status') status?: TicketStatus) {
    this.ticketsService.assertTenantWide(req.customerId);
    return this.ticketsService.list(req.tenantId, null, status);
  }

  // Lets the frontend's flat /tickets/:id route fetch a ticket without
  // already knowing which customer it belongs to (TicketsController's own
  // GET needs customerId in the path) - customerId: null here means "any
  // customer of this tenant," same as list() above.
  @Get(':id')
  get(@Req() req: any, @Param('id') id: string) {
    this.ticketsService.assertTenantWide(req.customerId);
    return this.ticketsService.get(req.tenantId, null, id);
  }

  @Patch(':id')
  update(@Req() req: any, @Param('id') id: string, @Body() dto: UpdateTicketDto) {
    this.ticketsService.assertTenantWide(req.customerId);
    return this.ticketsService.update(req.tenantId, id, dto);
  }
}
