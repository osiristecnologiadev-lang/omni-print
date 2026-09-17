import { Module } from '@nestjs/common';
import { EmailModule } from '../email/email.module';
import { OpsAlertsController } from './ops-alerts.controller';
import { OpsAlertService } from './ops-alerts.service';

@Module({
  imports: [EmailModule],
  controllers: [OpsAlertsController],
  providers: [OpsAlertService],
  exports: [OpsAlertService],
})
export class OpsAlertsModule {}
