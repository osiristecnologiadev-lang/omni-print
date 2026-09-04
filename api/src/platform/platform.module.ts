import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { PlatformAuthController } from './platform-auth.controller';
import { PlatformAuthService } from './platform-auth.service';
import { PlatformAuthGuard } from './platform-auth.guard';
import { PlatformController } from './platform.controller';
import { PlatformService } from './platform.service';

@Module({
  imports: [UsersModule],
  controllers: [PlatformAuthController, PlatformController],
  providers: [PlatformAuthService, PlatformAuthGuard, PlatformService],
})
export class PlatformModule {}
