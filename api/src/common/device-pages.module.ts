import { Module } from '@nestjs/common';
import { DevicePagesService } from './device-pages.service';

@Module({
  providers: [DevicePagesService],
  exports: [DevicePagesService],
})
export class DevicePagesModule {}
