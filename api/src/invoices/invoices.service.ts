import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ContractsService, monthRange } from '../contracts/contracts.service';

// The due date for a billed month always falls in the FOLLOWING calendar
// month, on the covering contract's billingDay (clamped to that month's
// actual length - e.g. billingDay 31 in a 30-day month becomes the 30th).
function dueDateFor(billingDay: number, periodEnd: Date): Date {
  const billedYear = periodEnd.getUTCFullYear();
  const billedMonthIndex = periodEnd.getUTCMonth();
  const dueMonthIndex = billedMonthIndex + 1; // Date.UTC rolls this into January of next year when needed
  const daysInDueMonth = new Date(Date.UTC(billedYear, dueMonthIndex + 1, 0)).getUTCDate();
  const day = Math.min(billingDay, daysInDueMonth);
  return new Date(Date.UTC(billedYear, dueMonthIndex, day, 23, 59, 59, 999));
}

function isUniqueConstraintError(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

@Injectable()
export class InvoicesService {
  private readonly logger = new Logger(InvoicesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly contractsService: ContractsService,
  ) {}

  async list(tenantId: string, customerId: string) {
    await this.contractsService.requireCustomer(tenantId, customerId);
    return this.prisma.invoice.findMany({
      where: { tenantId, customerId },
      orderBy: { periodStart: 'desc' },
    });
  }

  async get(tenantId: string, customerId: string, invoiceId: string) {
    const invoice = await this.prisma.invoice.findFirst({ where: { id: invoiceId, tenantId, customerId } });
    if (!invoice) {
      throw new NotFoundException('invoice not found');
    }
    return invoice;
  }

  // Idempotent by design: both the nightly cron and a manual re-trigger call
  // this, and @@unique([customerId, periodStart]) on Invoice guarantees a
  // second call for the same month returns the existing row rather than
  // double-billing. Every number is snapshotted onto the row at generation
  // time (see Invoice's schema comment) - editing the contract afterward
  // never changes an invoice that's already been generated.
  async generate(tenantId: string, customerId: string, year: number, month: number) {
    await this.contractsService.requireCustomer(tenantId, customerId);
    const { periodStart, periodEnd } = monthRange(year, month);

    const existing = await this.prisma.invoice.findUnique({
      where: { customerId_periodStart: { customerId, periodStart } },
    });
    if (existing) {
      return existing;
    }

    const billing = await this.contractsService.resolveBilling(tenantId, customerId, periodStart, periodEnd);
    if (!billing.hasContract) {
      throw new NotFoundException('no contract covers this period');
    }

    const dueDate = dueDateFor(billing.contract.billingDay, periodEnd);

    try {
      return await this.prisma.invoice.create({
        data: {
          tenantId,
          customerId,
          contractId: billing.contract.id,
          periodStart,
          periodEnd,
          dueDate,
          pricingModel: billing.contract.pricingModel,
          totalPages: billing.totalPages,
          monoPages: billing.monoPages,
          colorPages: billing.colorPages,
          perDevice: billing.perDevice as unknown as Prisma.InputJsonValue,
          fixedFee: billing.fixedFee,
          usageCost: billing.usageCost,
          totalDue: billing.totalDue,
        },
      });
    } catch (err) {
      // Lost a race with another request/the cron generating the same
      // period concurrently - fetch what won instead of erroring out.
      if (isUniqueConstraintError(err)) {
        const raced = await this.prisma.invoice.findUnique({
          where: { customerId_periodStart: { customerId, periodStart } },
        });
        if (raced) {
          return raced;
        }
      }
      throw err;
    }
  }

  async markPaid(tenantId: string, customerId: string, invoiceId: string, paidAmount?: number) {
    const invoice = await this.get(tenantId, customerId, invoiceId);
    if (invoice.status === 'CANCELLED') {
      throw new ForbiddenException('cannot mark a cancelled invoice as paid');
    }
    return this.prisma.invoice.update({
      where: { id: invoiceId },
      data: {
        status: 'PAID',
        paidAt: new Date(),
        paidAmount: paidAmount ?? invoice.totalDue,
      },
    });
  }

  async cancel(tenantId: string, customerId: string, invoiceId: string) {
    const invoice = await this.get(tenantId, customerId, invoiceId);
    if (invoice.status === 'PAID') {
      throw new ForbiddenException('cannot cancel an invoice that was already paid');
    }
    return this.prisma.invoice.update({ where: { id: invoiceId }, data: { status: 'CANCELLED' } });
  }

  // Tenant-wide billing signals for a dashboard/banner: contracts ending
  // within 30 days, and invoices past their due date still unpaid.
  async alerts(tenantId: string) {
    const now = new Date();
    const soon = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    const [expiringContracts, overdueInvoices] = await Promise.all([
      this.prisma.contract.findMany({
        where: { tenantId, status: 'ACTIVE', endDate: { not: null, lte: soon, gte: now } },
        include: { customer: true },
        orderBy: { endDate: 'asc' },
      }),
      this.prisma.invoice.findMany({
        where: { tenantId, status: 'PENDING', dueDate: { lt: now } },
        include: { customer: true },
        orderBy: { dueDate: 'asc' },
      }),
    ]);

    return { expiringContracts, overdueInvoices };
  }

  // Tenant-wide usage/revenue report - distinct from the per-customer
  // invoice list (InvoicesController) and the live billing preview
  // (ContractsService.resolveBilling): this is a portfolio-level view built
  // entirely from already-generated, already-snapshotted Invoice rows (no
  // live recomputation against Metric history), so it's cheap and always
  // reflects exactly what was actually billed. `months` counts back from
  // the current calendar month inclusive (months=6 means this month plus
  // the 5 before it).
  async usageRevenueReport(tenantId: string, months: number) {
    const now = new Date();
    const windowStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (months - 1), 1));

    const invoices = await this.prisma.invoice.findMany({
      where: { tenantId, periodStart: { gte: windowStart }, status: { not: 'CANCELLED' } },
      include: { customer: { select: { id: true, name: true } } },
      orderBy: { periodStart: 'asc' },
    });

    // Keyed by periodStart's ISO date (always the 1st of a month - see
    // monthRange) so months with zero invoices still aren't silently
    // skipped, just absent from the map and backfilled as zero below.
    const byMonth = new Map<string, { totalDue: number; paidAmount: number; totalPages: number }>();
    const byCustomer = new Map<
      string,
      { customerId: string; customerName: string; totalDue: number; paidAmount: number; outstanding: number; totalPages: number; invoiceCount: number }
    >();

    let totalRevenue = 0;
    let totalPaid = 0;
    let totalOutstanding = 0;
    let totalPages = 0;

    for (const inv of invoices) {
      const due = Number(inv.totalDue);
      const paid = inv.paidAmount != null ? Number(inv.paidAmount) : inv.status === 'PAID' ? due : 0;
      const outstanding = inv.status === 'PENDING' ? due : 0;

      totalRevenue += due;
      totalPaid += paid;
      totalOutstanding += outstanding;
      totalPages += inv.totalPages;

      const monthKey = inv.periodStart.toISOString().slice(0, 10);
      const month = byMonth.get(monthKey) ?? { totalDue: 0, paidAmount: 0, totalPages: 0 };
      month.totalDue += due;
      month.paidAmount += paid;
      month.totalPages += inv.totalPages;
      byMonth.set(monthKey, month);

      const customer = byCustomer.get(inv.customerId) ?? {
        customerId: inv.customerId,
        customerName: inv.customer.name,
        totalDue: 0,
        paidAmount: 0,
        outstanding: 0,
        totalPages: 0,
        invoiceCount: 0,
      };
      customer.totalDue += due;
      customer.paidAmount += paid;
      customer.outstanding += outstanding;
      customer.totalPages += inv.totalPages;
      customer.invoiceCount += 1;
      byCustomer.set(inv.customerId, customer);
    }

    // Backfill every month in the window, even ones with zero invoices, so
    // a revenue trend chart doesn't show a misleading gap vs. a real zero.
    const monthly: Array<{ month: string; totalDue: number; paidAmount: number; totalPages: number }> = [];
    for (let i = 0; i < months; i++) {
      const d = new Date(Date.UTC(windowStart.getUTCFullYear(), windowStart.getUTCMonth() + i, 1));
      const key = d.toISOString().slice(0, 10);
      const bucket = byMonth.get(key) ?? { totalDue: 0, paidAmount: 0, totalPages: 0 };
      monthly.push({ month: key, ...bucket });
    }

    return {
      months,
      windowStart: windowStart.toISOString(),
      totalRevenue,
      totalPaid,
      totalOutstanding,
      totalPages,
      monthly,
      byCustomer: [...byCustomer.values()].sort((a, b) => b.totalDue - a.totalDue),
    };
  }

  // Runs once a day: as soon as a calendar month fully closes, generate the
  // invoice for every customer whose contract covered it - so by the time
  // the contract's own billingDay arrives, the PDF already exists instead of
  // being computed for the first time under pressure. Safe to fail per
  // customer: one bad row shouldn't block everyone else's invoice.
  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async generateDueInvoices() {
    const now = new Date();
    const lastMonthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
    const year = lastMonthEnd.getUTCFullYear();
    const month = lastMonthEnd.getUTCMonth() + 1;

    const customers = await this.prisma.customer.findMany({
      where: { contracts: { some: {} } },
      select: { id: true, tenantId: true },
    });

    for (const customer of customers) {
      try {
        await this.generate(customer.tenantId, customer.id, year, month);
      } catch (err) {
        if (err instanceof NotFoundException) {
          continue; // no contract covered that period for this customer - nothing to bill
        }
        this.logger.error(`failed to generate invoice for customer ${customer.id} (${year}-${month})`, err as Error);
      }
    }
  }
}
