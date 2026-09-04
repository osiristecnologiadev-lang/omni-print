import { Module } from '@nestjs/common';
import { ContractsController } from './contracts.controller';
import { CurrentPeriodReportController } from './current-period-report.controller';
import { ContractsService } from './contracts.service';

@Module({
  controllers: [ContractsController, CurrentPeriodReportController],
  providers: [ContractsService],
  exports: [ContractsService],
})
export class ContractsModule {}
