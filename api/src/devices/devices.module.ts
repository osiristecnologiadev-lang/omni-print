import { Module } from '@nestjs/common';
import { DevicesController } from './devices.controller';
import { DevicesService } from './devices.service';
import { DevicePagesModule } from '../common/device-pages.module';

// UserAuthGuard comes from the global AuthModule - no need to re-provide it.
@Module({
  imports: [DevicePagesModule],
  controllers: [DevicesController],
  providers: [DevicesService],
  exports: [DevicesService],
})
export class DevicesModule {}
