import { Module } from '@nestjs/common';
import { AgentLogController } from './agent-log.controller';
import { AgentLogService } from './agent-log.service';

@Module({
  controllers: [AgentLogController],
  providers: [AgentLogService],
  exports: [AgentLogService],
})
export class AgentLogModule {}
