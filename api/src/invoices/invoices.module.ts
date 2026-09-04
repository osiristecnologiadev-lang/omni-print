import { Module } from '@nestjs/common';
import { ContractsModule } from '../contracts/contracts.module';
import { InvoicesController } from './invoices.controller';
import { BillingAlertsController } from './billing-alerts.controller';
import { UsageRevenueReportController } from './usage-revenue-report.controller';
import { InvoicesService } from './invoices.service';
import { InvoicePdfService } from './invoice-pdf.service';

@Module({
  imports: [ContractsModule],
  controllers: [InvoicesController, BillingAlertsController, UsageRevenueReportController],
  providers: [InvoicesService, InvoicePdfService],
  exports: [InvoicesService],
})
export class InvoicesModule {}
