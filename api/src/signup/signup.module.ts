import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { SignupController } from './signup.controller';
import { SignupService } from './signup.service';

@Module({
  imports: [UsersModule],
  controllers: [SignupController],
  providers: [SignupService],
})
export class SignupModule {}
