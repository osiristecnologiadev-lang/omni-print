import { Module } from '@nestjs/common';
import { AgentEnrollmentController } from './agent-enrollment.controller';
import { AgentEnrollmentService } from './agent-enrollment.service';

@Module({
  controllers: [AgentEnrollmentController],
  providers: [AgentEnrollmentService],
})
export class AgentEnrollmentModule {}
