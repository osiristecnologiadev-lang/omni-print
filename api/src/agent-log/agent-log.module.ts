import { Module } from '@nestjs/common';
import { AgentLogController, AgentLogsController } from './agent-log.controller';
import { AgentLogService } from './agent-log.service';

@Module({
  controllers: [AgentLogController, AgentLogsController],
  providers: [AgentLogService],
  exports: [AgentLogService],
})
export class AgentLogModule {}
