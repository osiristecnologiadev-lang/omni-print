import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  controllers: [UsersController],
  providers: [UsersService],
  // Reused by PlatformModule to bootstrap a new tenant's first user.
  exports: [UsersService],
})
export class UsersModule {}
