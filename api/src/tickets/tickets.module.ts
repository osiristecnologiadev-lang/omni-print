import { Module } from '@nestjs/common';
import { EmailModule } from '../email/email.module';
import { TicketsController } from './tickets.controller';
import { TicketsManagementController } from './tickets-management.controller';
import { TicketsService } from './tickets.service';

@Module({
  imports: [EmailModule],
  controllers: [TicketsController, TicketsManagementController],
  providers: [TicketsService],
  exports: [TicketsService],
})
export class TicketsModule {}
