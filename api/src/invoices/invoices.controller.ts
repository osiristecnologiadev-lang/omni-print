import { Body, Controller, ForbiddenException, Get, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { UserAuthGuard } from '../auth/user-auth.guard';
import { AuditLogService } from '../audit-log/audit-log.service';
import { PrismaService } from '../prisma/prisma.service';
import { InvoicesService } from './invoices.service';
import { InvoicePdfService } from './invoice-pdf.service';
import { GenerateInvoiceDto } from './dto/generate-invoice.dto';
import { MarkPaidDto } from './dto/mark-paid.dto';

// Same access rule as contracts: this is the outsourcing tenant's own
// billing paperwork for its client, not something that client's read-only
// login should see - see ContractsController's comment for the full reason.
@UseGuards(UserAuthGuard)
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
    this.assertTenantWide(req.customerId);
    return this.invoicesService.list(req.tenantId, customerId);
  }

  @Get(':invoiceId')
  get(@Req() req: any, @Param('customerId') customerId: string, @Param('invoiceId') invoiceId: string) {
    this.assertTenantWide(req.customerId);
    return this.invoicesService.get(req.tenantId, customerId, invoiceId);
  }

  // Manual trigger - mainly for months before the cron existed, or for
  // generating the current (still-open) month early as a preview-turned-
  // real invoice. The nightly cron calls the same service method, so both
  // paths share the same idempotency guarantee.
  @Post('generate')
  async generate(@Req() req: any, @Param('customerId') customerId: string, @Body() dto: GenerateInvoiceDto) {
    this.assertTenantWide(req.customerId);
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
    this.assertTenantWide(req.customerId);
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
    this.assertTenantWide(req.customerId);
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
    this.assertTenantWide(req.customerId);
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
    });
    doc.pipe(res);
    doc.end();
  }

  private assertTenantWide(customerId: string | null) {
    if (customerId) {
      throw new ForbiddenException('only tenant-wide users can do this');
    }
  }
}
