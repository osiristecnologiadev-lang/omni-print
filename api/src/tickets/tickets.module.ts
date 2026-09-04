import { Module } from '@nestjs/common';
import { TicketsController } from './tickets.controller';
import { TicketsManagementController } from './tickets-management.controller';
import { TicketsService } from './tickets.service';

@Module({
  controllers: [TicketsController, TicketsManagementController],
  providers: [TicketsService],
})
export class TicketsModule {}
