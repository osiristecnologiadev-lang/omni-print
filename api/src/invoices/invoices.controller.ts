import { Body, Controller, Get, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { UserAuthGuard } from '../auth/user-auth.guard';
import { SubscriptionGuard } from '../subscription/subscription.guard';
import { assertPermission, assertInvoiceReadAccess } from '../auth/permissions.util';
import { AuditLogService } from '../audit-log/audit-log.service';
import { PrismaService } from '../prisma/prisma.service';
import { InvoicesService } from './invoices.service';
import { InvoicePdfService } from './invoice-pdf.service';
import { GenerateInvoiceDto } from './dto/generate-invoice.dto';
import { MarkPaidDto } from './dto/mark-paid.dto';

// Writes (generate/pay/cancel) are tenant-wide only, same as contracts -
// see ContractsController's comment. Reads (list/get/pdf) are the one
// place a customer-scoped login can be granted access beyond the always-
// open device/ticket routes: a customer with the invoices_view permission
// can see and download their OWN invoices only (assertInvoiceReadAccess
// enforces the customerId match) - they can't generate, mark paid, or
// cancel anything.
@UseGuards(UserAuthGuard, SubscriptionGuard)
@Controller('v1/customers/:customerId/invoices')
export class InvoicesController {
  constructor(
    private readonly invoicesService: InvoicesService,
    private readonly pdfService: InvoicePdfService,
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

  @Get()
  list(@Req() req: any, @Param('customerId') customerId: string) {
    assertInvoiceReadAccess(req, customerId);
    return this.invoicesService.list(req.tenantId, customerId);
  }

  @Get(':invoiceId')
  get(@Req() req: any, @Param('customerId') customerId: string, @Param('invoiceId') invoiceId: string) {
    assertInvoiceReadAccess(req, customerId);
    return this.invoicesService.get(req.tenantId, customerId, invoiceId);
  }

  // Manual trigger - mainly for months before the cron existed, or for
  // generating the current (still-open) month early as a preview-turned-
  // real invoice. The nightly cron calls the same service method, so both
  // paths share the same idempotency guarantee.
  @Post('generate')
  async generate(@Req() req: any, @Param('customerId') customerId: string, @Body() dto: GenerateInvoiceDto) {
    assertPermission(req, 'invoices');
    const invoice = await this.invoicesService.generate(req.tenantId, customerId, dto.year, dto.month);
    await this.auditLog.log({
      tenantId: req.tenantId,
      actorType: 'USER',
      actorId: req.userId,
      actorLabel: req.userEmail,
      action: 'invoice.generate',
      targetType: 'Invoice',
      targetId: invoice.id,
      targetLabel: `Nº ${String(invoice.number).padStart(6, '0')}`,
      metadata: { customerId, year: dto.year, month: dto.month },
    });
    return invoice;
  }

  @Post(':invoiceId/pay')
  async markPaid(
    @Req() req: any,
    @Param('customerId') customerId: string,
    @Param('invoiceId') invoiceId: string,
    @Body() dto: MarkPaidDto,
  ) {
    assertPermission(req, 'invoices');
    const invoice = await this.invoicesService.markPaid(req.tenantId, customerId, invoiceId, dto.paidAmount);
    await this.auditLog.log({
      tenantId: req.tenantId,
      actorType: 'USER',
      actorId: req.userId,
      actorLabel: req.userEmail,
      action: 'invoice.mark_paid',
      targetType: 'Invoice',
      targetId: invoice.id,
      targetLabel: `Nº ${String(invoice.number).padStart(6, '0')}`,
      metadata: { customerId, paidAmount: dto.paidAmount },
    });
    return invoice;
  }

  @Post(':invoiceId/cancel')
  async cancel(@Req() req: any, @Param('customerId') customerId: string, @Param('invoiceId') invoiceId: string) {
    assertPermission(req, 'invoices');
    const invoice = await this.invoicesService.cancel(req.tenantId, customerId, invoiceId);
    await this.auditLog.log({
      tenantId: req.tenantId,
      actorType: 'USER',
      actorId: req.userId,
      actorLabel: req.userEmail,
      action: 'invoice.cancel',
      targetType: 'Invoice',
      targetId: invoice.id,
      targetLabel: `Nº ${String(invoice.number).padStart(6, '0')}`,
      metadata: { customerId },
    });
    return invoice;
  }

  @Get(':invoiceId/pdf')
  async pdf(
    @Req() req: any,
    @Param('customerId') customerId: string,
    @Param('invoiceId') invoiceId: string,
    @Res() res: Response,
  ) {
    assertInvoiceReadAccess(req, customerId);
    const invoice = await this.invoicesService.get(req.tenantId, customerId, invoiceId);
    const [tenant, customer] = await Promise.all([
      this.prisma.tenant.findUniqueOrThrow({ where: { id: req.tenantId } }),
      this.prisma.customer.findUniqueOrThrow({ where: { id: customerId } }),
    ]);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="fatura-${invoice.id}.pdf"`);
    const doc = this.pdfService.build({
      invoice,
      issuer: {
        name: tenant.name,
        document: tenant.document,
        address: tenant.address,
        phone: tenant.phone,
        contactEmail: tenant.contactEmail,
      },
      customer: { name: customer.name, document: customer.document, address: customer.address },
      timezone: tenant.timezone,
      logoFilePath: tenant.logoFilePath,
    });
    doc.pipe(res);
    doc.end();
  }
}
