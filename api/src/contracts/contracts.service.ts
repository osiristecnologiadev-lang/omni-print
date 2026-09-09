import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DevicePagesService } from '../common/device-pages.service';
import { CreateContractDto } from './dto/create-contract.dto';
import { UpdateContractDto } from './dto/update-contract.dto';

@Injectable()
export class ContractsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly devicePages: DevicePagesService,
  ) {}

  async requireCustomer(tenantId: string, customerId: string) {
    const customer = await this.prisma.customer.findFirst({ where: { id: customerId, tenantId } });
    if (!customer) {
      throw new NotFoundException('customer not found');
    }
    return customer;
  }

  async list(tenantId: string, customerId: string) {
    await this.requireCustomer(tenantId, customerId);
    return this.prisma.contract.findMany({
      where: { tenantId, customerId },
      orderBy: { startDate: 'desc' },
    });
  }

  async getActive(tenantId: string, customerId: string) {
    await this.requireCustomer(tenantId, customerId);
    return this.prisma.contract.findFirst({
      where: { tenantId, customerId, status: 'ACTIVE' },
      orderBy: { startDate: 'desc' },
    });
  }

  // Renegotiating: expires whatever was ACTIVE before this new contract's
  // start date rather than allowing two ACTIVE rows for the same customer
  // at once - see Contract's comment in prisma/schema.prisma for why this
  // is modeled as history rather than overwritten fields.
  async create(tenantId: string, customerId: string, dto: CreateContractDto) {
    await this.requireCustomer(tenantId, customerId);

    const startDate = new Date(dto.startDate);

    const currentActive = await this.prisma.contract.findFirst({
      where: { tenantId, customerId, status: 'ACTIVE' },
    });
    if (currentActive) {
      await this.prisma.contract.update({
        where: { id: currentActive.id },
        data: { status: 'EXPIRED', endDate: currentActive.endDate ?? startDate },
      });
    }

    return this.prisma.contract.create({
      data: {
        tenantId,
        customerId,
        pricingModel: dto.pricingModel,
        startDate,
        endDate: dto.endDate ? new Date(dto.endDate) : null,
        billingDay: dto.billingDay,
        fixedFee: dto.fixedFee,
        includedPagesMono: dto.includedPagesMono,
        includedPagesColor: dto.includedPagesColor,
        overagePriceMono: dto.overagePriceMono,
        overagePriceColor: dto.overagePriceColor,
        pricePerPageMono: dto.pricePerPageMono,
        pricePerPageColor: dto.pricePerPageColor,
        minimumPagesMono: dto.minimumPagesMono,
        minimumPagesColor: dto.minimumPagesColor,
        setupFee: dto.setupFee,
        earlyTerminationFee: dto.earlyTerminationFee,
        adjustmentIndex: dto.adjustmentIndex,
        notes: dto.notes,
      },
    });
  }

  // Only the active contract can be edited in place - fixing a typo or a
  // date, not a pricing renegotiation (that goes through create(), which
  // preserves history).
  async update(tenantId: string, customerId: string, contractId: string, dto: UpdateContractDto) {
    await this.requireCustomer(tenantId, customerId);
    const contract = await this.prisma.contract.findFirst({ where: { id: contractId, tenantId, customerId } });
    if (!contract) {
      throw new NotFoundException('contract not found');
    }
    if (contract.status !== 'ACTIVE') {
      throw new ForbiddenException('only the active contract can be edited - create a new one to renegotiate terms');
    }

    return this.prisma.contract.update({
      where: { id: contractId },
      data: {
        ...(dto.pricingModel !== undefined ? { pricingModel: dto.pricingModel } : {}),
        ...(dto.startDate ? { startDate: new Date(dto.startDate) } : {}),
        ...(dto.endDate !== undefined ? { endDate: dto.endDate ? new Date(dto.endDate) : null } : {}),
        ...(dto.billingDay !== undefined ? { billingDay: dto.billingDay } : {}),
        ...(dto.fixedFee !== undefined ? { fixedFee: dto.fixedFee } : {}),
        ...(dto.includedPagesMono !== undefined ? { includedPagesMono: dto.includedPagesMono } : {}),
        ...(dto.includedPagesColor !== undefined ? { includedPagesColor: dto.includedPagesColor } : {}),
        ...(dto.overagePriceMono !== undefined ? { overagePriceMono: dto.overagePriceMono } : {}),
        ...(dto.overagePriceColor !== undefined ? { overagePriceColor: dto.overagePriceColor } : {}),
        ...(dto.pricePerPageMono !== undefined ? { pricePerPageMono: dto.pricePerPageMono } : {}),
        ...(dto.pricePerPageColor !== undefined ? { pricePerPageColor: dto.pricePerPageColor } : {}),
        ...(dto.minimumPagesMono !== undefined ? { minimumPagesMono: dto.minimumPagesMono } : {}),
        ...(dto.minimumPagesColor !== undefined ? { minimumPagesColor: dto.minimumPagesColor } : {}),
        ...(dto.setupFee !== undefined ? { setupFee: dto.setupFee } : {}),
        ...(dto.earlyTerminationFee !== undefined ? { earlyTerminationFee: dto.earlyTerminationFee } : {}),
        ...(dto.adjustmentIndex !== undefined ? { adjustmentIndex: dto.adjustmentIndex } : {}),
        ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
      },
    });
  }

  async cancel(tenantId: string, customerId: string, contractId: string) {
    await this.requireCustomer(tenantId, customerId);
    const contract = await this.prisma.contract.findFirst({ where: { id: contractId, tenantId, customerId } });
    if (!contract) {
      throw new NotFoundException('contract not found');
    }
    return this.prisma.contract.update({
      where: { id: contractId },
      data: { status: 'CANCELLED', endDate: contract.endDate ?? new Date() },
    });
  }

  // Computes what's owed for one calendar month, using whichever contract
  // covered the start of that month (so re-running this for a past month
  // stays correct even after a renegotiation). The formula depends on
  // pricingModel - see Contract's schema comment for what each model means
  // and the mono/color billing simplification every model relies on.
  // This is the ad hoc *preview* (used by the on-screen calculator for any
  // month, including ones with no persisted invoice yet) - InvoicesService
  // calls resolveBilling directly to build the row it actually persists.
  async calculateBilling(tenantId: string, customerId: string, year: number, month: number) {
    await this.requireCustomer(tenantId, customerId);
    const { periodStart, periodEnd } = monthRange(year, month);
    return this.resolveBilling(tenantId, customerId, periodStart, periodEnd);
  }

  // "How much is already earned this month, right now" - not a final
  // invoice (that only exists once the month closes and
  // InvoicesService.generateDueInvoices runs), just resolveBilling run
  // against the still-open current month with periodEnd = now instead of
  // the month's last instant. Same math, same per-device meter-reading
  // proof, just a shorter (in-progress) window - lets the outsourcing
  // tenant see "what's guaranteed so far" without waiting for the period
  // to close, and updates every time real usage data comes in.
  async currentPeriodPreview(tenantId: string, customerId: string) {
    await this.requireCustomer(tenantId, customerId);
    const now = new Date();
    const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    return this.resolveBilling(tenantId, customerId, periodStart, now);
  }

  // Same idea as currentPeriodPreview, summed across every customer with an
  // ACTIVE contract right now - "how much is guaranteed across my whole
  // portfolio this month so far," for the outsource owner's own overview
  // rather than one customer at a time. A customer with no active contract
  // simply doesn't contribute (nothing to preview).
  async portfolioCurrentPeriodPreview(tenantId: string) {
    const now = new Date();
    const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

    const activeContracts = await this.prisma.contract.findMany({
      where: { tenantId, status: 'ACTIVE' },
      include: { customer: { select: { id: true, name: true } } },
    });

    const byCustomer = await Promise.all(
      activeContracts.map(async (contract) => {
        const billing = await this.resolveBilling(tenantId, contract.customerId, periodStart, now);
        return {
          customerId: contract.customerId,
          customerName: contract.customer.name,
          totalDue: billing.hasContract ? billing.totalDue : 0,
          totalPages: billing.hasContract ? billing.totalPages : 0,
        };
      }),
    );

    return {
      periodStart: periodStart.toISOString(),
      periodEnd: now.toISOString(),
      totalAccrued: byCustomer.reduce((sum, c) => sum + c.totalDue, 0),
      byCustomer: byCustomer.sort((a, b) => b.totalDue - a.totalDue),
    };
  }

  // Same computation as calculateBilling, but for an arbitrary period and
  // without the customer-existence check (callers that already resolved the
  // customer, like InvoicesService's cron sweep across many customers,
  // shouldn't pay for it twice).
  async resolveBilling(tenantId: string, customerId: string, periodStart: Date, periodEnd: Date) {
    const contract = await this.prisma.contract.findFirst({
      where: {
        tenantId,
        customerId,
        startDate: { lte: periodEnd },
        OR: [{ endDate: null }, { endDate: { gte: periodStart } }],
      },
      // Two contracts can legitimately tie on startDate (a same-day
      // renegotiation - confirmed happening in testing) or on the boundary
      // where one's endDate equals the next one's startDate (inclusive on
      // both sides by design, so the day of a renegotiation resolves to
      // *a* contract deterministically rather than either/neither). createdAt
      // breaks the tie in favor of whichever was entered later - the result
      // of the more recent renegotiation, which is the intended winner.
      orderBy: [{ startDate: 'desc' }, { createdAt: 'desc' }],
    });

    if (!contract) {
      return { hasContract: false as const, periodStart, periodEnd };
    }

    const devices = await this.prisma.device.findMany({ where: { tenantId, customerId } });

    const perDevice = await Promise.all(
      devices.map(async (device) => {
        const {
          pages,
          monoPages,
          colorPages,
          startReading,
          endReading,
          counterReset,
          usedManualBaseline,
          usedFallbackForReset,
          enginePages,
          engineStartReading,
          engineEndReading,
        } = await this.devicePages.pagesInPeriod(device, periodStart, periodEnd);
        return {
          deviceId: device.id,
          deviceName: device.customLabel ?? device.printerName ?? device.name ?? device.host,
          serialNumber: device.serialNumber,
          host: device.host,
          pages,
          monoPages,
          colorPages,
          // Meter reading proof (leitura anterior/atual) - the standard way
          // print-outsourcing invoices in this market justify the billed
          // page count, not just the delta on its own. Null when there's no
          // metric at all for the device in/before the period (never polled
          // yet) - the PDF shows "—" for that case rather than a fake 0.
          startReading,
          endReading,
          // True when pagesInPeriod detected a counter drop during the
          // period (device reset/replaced) - pages already account for it
          // correctly, this is purely a transparency flag so whoever reviews
          // the bill can see why start/end readings alone don't explain the
          // total (see the PDF/UI, which show a note when this is true).
          counterReset,
          // True when the "leitura anterior" above is actually the manually
          // entered baseline, not a real poll - see
          // Device.manualBaselineDate's schema comment.
          usedManualBaseline,
          // True when a hop's delta came from the engine counter because
          // the printed-pages counter itself reset that hop - a more
          // specific reason within counterReset, not a separate problem.
          usedFallbackForReset,
          // The device's own lifetime engine/mechanism counter and its
          // start/end readings for this period - shown as supplementary
          // info alongside pages/startReading/endReading above, which
          // prefer the "printed" counter when available. See
          // Collector.collectMarkerSplit's comment for why these two
          // numbers can differ a lot on the same device.
          enginePages,
          engineStartReading,
          engineEndReading,
        };
      }),
    );

    const totalPages = perDevice.reduce((sum, d) => sum + d.pages, 0);
    const monoPages = perDevice.reduce((sum, d) => sum + d.monoPages, 0);
    const colorPages = perDevice.reduce((sum, d) => sum + d.colorPages, 0);
    const fixedFee = Number(contract.fixedFee ?? 0);

    let usageCost = 0;
    let includedTotal: number | null = null;
    let overagePages: number | null = null;
    let billablePages: number | null = null;
    let minimumPages: number | null = null;

    switch (contract.pricingModel) {
      case 'FLAT_RATE':
        // Page count doesn't affect price - shown for visibility only.
        break;

      // Mono and color overage are billed separately, each against its own
      // allowance/rate. A device that can't report a real mono/color split
      // (see Metric.monoPageCount's schema comment) has all of its pages
      // counted as mono and none as color - so this degrades exactly to the
      // old "everything at the mono rate" behavior for a fleet with no split
      // data, and improves automatically as devices start reporting one.
      case 'ALLOWANCE_PLUS_OVERAGE': {
        const overageMono = Math.max(0, monoPages - (contract.includedPagesMono ?? 0));
        const overageColor = Math.max(0, colorPages - (contract.includedPagesColor ?? 0));
        includedTotal = (contract.includedPagesMono ?? 0) + (contract.includedPagesColor ?? 0);
        overagePages = overageMono + overageColor;
        usageCost =
          overageMono * Number(contract.overagePriceMono ?? 0) + overageColor * Number(contract.overagePriceColor ?? 0);
        break;
      }

      case 'PER_PAGE': {
        const billableMono = Math.max(contract.minimumPagesMono ?? 0, monoPages);
        const billableColor = Math.max(contract.minimumPagesColor ?? 0, colorPages);
        minimumPages = (contract.minimumPagesMono ?? 0) + (contract.minimumPagesColor ?? 0);
        billablePages = billableMono + billableColor;
        usageCost =
          billableMono * Number(contract.pricePerPageMono ?? 0) + billableColor * Number(contract.pricePerPageColor ?? 0);
        break;
      }
    }

    return {
      hasContract: true as const,
      periodStart,
      periodEnd,
      contract,
      perDevice,
      totalPages,
      monoPages,
      colorPages,
      fixedFee,
      includedTotal,
      overagePages,
      minimumPages,
      billablePages,
      usageCost,
      totalDue: fixedFee + usageCost,
    };
  }
}

export function monthRange(year: number, month: number): { periodStart: Date; periodEnd: Date } {
  return {
    periodStart: new Date(Date.UTC(year, month - 1, 1, 0, 0, 0)),
    periodEnd: new Date(Date.UTC(year, month, 0, 23, 59, 59, 999)), // last instant of the month
  };
}
