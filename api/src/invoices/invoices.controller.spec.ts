import { ForbiddenException } from '@nestjs/common';
import { InvoicesController } from './invoices.controller';
import type { InvoicesService } from './invoices.service';
import type { InvoicePdfService } from './invoice-pdf.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { AuditLogService } from '../audit-log/audit-log.service';

// Covers assertInvoiceReadAccess's branches at the controller level - the
// one place in this app a customer-scoped session can read data beyond the
// always-open device/ticket routes (see permissions.util.ts).
describe('InvoicesController read access', () => {
  let controller: InvoicesController;
  let invoicesService: { list: jest.Mock; get: jest.Mock };

  beforeEach(() => {
    invoicesService = { list: jest.fn().mockResolvedValue([]), get: jest.fn() };
    controller = new InvoicesController(
      invoicesService as unknown as InvoicesService,
      {} as unknown as InvoicePdfService,
      {} as unknown as PrismaService,
      {} as unknown as AuditLogService,
    );
  });

  it('lets a tenant-wide user with invoices read any customer', () => {
    controller.list({ tenantId: 't1', customerId: null, permissions: ['invoices'] }, 'any-customer');
    expect(invoicesService.list).toHaveBeenCalledWith('t1', 'any-customer');
  });

  it('rejects a tenant-wide user missing invoices', () => {
    expect(() =>
      controller.list({ tenantId: 't1', customerId: null, permissions: [] }, 'c1'),
    ).toThrow(ForbiddenException);
  });

  it('lets a customer-scoped user with invoices_view read their own customer', () => {
    controller.list({ tenantId: 't1', customerId: 'c1', permissions: ['invoices_view'] }, 'c1');
    expect(invoicesService.list).toHaveBeenCalledWith('t1', 'c1');
  });

  it('rejects a customer-scoped user with invoices_view reading a different customer', () => {
    expect(() =>
      controller.list({ tenantId: 't1', customerId: 'c1', permissions: ['invoices_view'] }, 'c2'),
    ).toThrow(ForbiddenException);
    expect(invoicesService.list).not.toHaveBeenCalled();
  });

  it('rejects a customer-scoped user without invoices_view at all', () => {
    expect(() =>
      controller.get({ tenantId: 't1', customerId: 'c1', permissions: [] }, 'c1', 'inv1'),
    ).toThrow(ForbiddenException);
  });
});
