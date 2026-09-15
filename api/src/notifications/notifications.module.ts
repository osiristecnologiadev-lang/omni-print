import { Module } from '@nestjs/common';
import { InvoicesModule } from '../invoices/invoices.module';
import { DevicesModule } from '../devices/devices.module';
import { EmailModule } from '../email/email.module';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

@Module({
  imports: [InvoicesModule, DevicesModule, EmailModule],
  controllers: [NotificationsController],
  providers: [NotificationsService],
})
export class NotificationsModule {}
