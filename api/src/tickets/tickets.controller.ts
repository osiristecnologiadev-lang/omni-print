import { Body, Controller, ForbiddenException, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { TicketStatus } from '@prisma/client';
import { UserAuthGuard } from '../auth/user-auth.guard';
import { SubscriptionGuard } from '../subscription/subscription.guard';
import { TicketsService } from './tickets.service';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { AddCommentDto } from './dto/add-comment.dto';

// Scoped like DevicesController, not like ContractsController: both
// tenant-wide staff AND the customer who owns the ticket can create/read/
// comment here - a customer-scoped session isn't blocked outright, it's
// restricted to its own customerId. Status/priority/assignment changes are
// staff-only - see tickets-management.controller.ts.
@UseGuards(UserAuthGuard, SubscriptionGuard)
@Controller('v1/customers/:customerId/tickets')
export class TicketsController {
  constructor(private readonly ticketsService: TicketsService) {}

  @Get()
  list(@Req() req: any, @Param('customerId') customerId: string, @Query('status') status?: TicketStatus) {
    this.assertScopeMatches(req, customerId);
    return this.ticketsService.list(req.tenantId, customerId, status);
  }

  @Post()
  create(@Req() req: any, @Param('customerId') customerId: string, @Body() dto: CreateTicketDto) {
    this.assertScopeMatches(req, customerId);
    return this.ticketsService.create(req.tenantId, customerId, req.userId, dto);
  }

  @Get(':id')
  get(@Req() req: any, @Param('customerId') customerId: string, @Param('id') id: string) {
    this.assertScopeMatches(req, customerId);
    return this.ticketsService.get(req.tenantId, customerId, id);
  }

  @Post(':id/comments')
  addComment(
    @Req() req: any,
    @Param('customerId') customerId: string,
    @Param('id') id: string,
    @Body() dto: AddCommentDto,
  ) {
    this.assertScopeMatches(req, customerId);
    return this.ticketsService.addComment(req.tenantId, customerId, id, req.userId, dto.body);
  }

  // A customer-scoped session must operate on exactly its own customerId -
  // the route param still exists (rather than reading req.customerId alone)
  // so a tenant-wide user can target any customer by URL. A customer-scoped
  // user with a mismatched id in the URL is rejected outright rather than
  // silently falling back to their own scope.
  private assertScopeMatches(req: any, customerId: string) {
    if (req.customerId && req.customerId !== customerId) {
      throw new ForbiddenException('customer mismatch');
    }
  }
}
