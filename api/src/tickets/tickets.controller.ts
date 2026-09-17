import { createReadStream } from 'fs';
import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { Response } from 'express';
import { TicketStatus } from '@prisma/client';
import { UserAuthGuard } from '../auth/user-auth.guard';
import { SubscriptionGuard } from '../subscription/subscription.guard';
import { TicketsService, ALLOWED_ATTACHMENT_MIME_TYPES, MAX_ATTACHMENT_BYTES } from './tickets.service';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { AddCommentDto } from './dto/add-comment.dto';

// A single-file field, same name on both the creation and comment forms -
// see web/'s CreateTicketForm/comment form, both plain multipart POSTs (a
// file input needs multipart regardless of whether one was actually
// picked, so both endpoints always parse as multipart now, not just when
// there's a file - @UploadedFile() is simply undefined when there isn't).
const ATTACHMENT_INTERCEPTOR = FileInterceptor('attachment', {
  limits: { fileSize: MAX_ATTACHMENT_BYTES },
  fileFilter: (_req, file, cb) => {
    cb(null, ALLOWED_ATTACHMENT_MIME_TYPES.includes(file.mimetype));
  },
});

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

  // Tighter than the 60/min global default - each request can write up to
  // MAX_ATTACHMENT_BYTES to disk, and a customer-scoped session (not just
  // staff) can hit this route, same reasoning as ingest.controller.ts's
  // own write-heavy override.
  @Post()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @UseInterceptors(ATTACHMENT_INTERCEPTOR)
  create(
    @Req() req: any,
    @Param('customerId') customerId: string,
    @Body() dto: CreateTicketDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    this.assertScopeMatches(req, customerId);
    return this.ticketsService.create(req.tenantId, customerId, req.userId, dto, file);
  }

  @Get(':id')
  get(@Req() req: any, @Param('customerId') customerId: string, @Param('id') id: string) {
    this.assertScopeMatches(req, customerId);
    // req.customerId (not the URL param) - null for a staff caller even
    // though they hit this same customer-scoped route (e.g. from the
    // ticket detail page, which always binds to the ticket's own
    // customerId regardless of viewer). get() uses a truthy customerId to
    // decide whether to filter out internal notes - passing the URL value
    // here would wrongly hide them from staff too.
    return this.ticketsService.get(req.tenantId, req.customerId, id);
  }

  @Post(':id/comments')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @UseInterceptors(ATTACHMENT_INTERCEPTOR)
  addComment(
    @Req() req: any,
    @Param('customerId') customerId: string,
    @Param('id') id: string,
    @Body() dto: AddCommentDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    this.assertScopeMatches(req, customerId);
    const isStaff = !req.customerId;
    return this.ticketsService.addComment(req.tenantId, customerId, id, req.userId, isStaff, dto.body, dto.internal ?? false, file);
  }

  @Get(':id/attachments/:attachmentId')
  async downloadAttachment(
    @Req() req: any,
    @Param('customerId') customerId: string,
    @Param('id') id: string,
    @Param('attachmentId') attachmentId: string,
    @Res() res: Response,
  ) {
    this.assertScopeMatches(req, customerId);
    // Same req.customerId-not-URL-customerId reasoning as get() above - a
    // staff caller must not be treated as customer-scoped here either, or
    // they'd be wrongly blocked from downloading their own internal-note
    // attachments.
    const attachment = await this.ticketsService.getAttachmentForDownload(req.tenantId, req.customerId, id, attachmentId);
    res.setHeader('Content-Type', attachment.mimeType);
    res.setHeader('Content-Disposition', `inline; filename="${attachment.filename.replace(/"/g, '')}"`);
    createReadStream(attachment.storedPath).pipe(res);
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
