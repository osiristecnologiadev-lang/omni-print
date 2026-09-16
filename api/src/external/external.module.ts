import { Module } from '@nestjs/common';
import { DevicesModule } from '../devices/devices.module';
import { CustomersModule } from '../customers/customers.module';
import { InvoicesModule } from '../invoices/invoices.module';
import { ApiKeysModule } from '../api-keys/api-keys.module';
import { ExternalController } from './external.controller';

@Module({
  imports: [DevicesModule, CustomersModule, InvoicesModule, ApiKeysModule],
  controllers: [ExternalController],
})
export class ExternalModule {}
