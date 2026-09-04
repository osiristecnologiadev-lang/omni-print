import { Module } from '@nestjs/common';
import { IngestController } from './ingest.controller';
import { IngestService } from './ingest.service';
import { AgentAuthGuard } from '../auth/agent-auth.guard';

@Module({
  controllers: [IngestController],
  providers: [IngestService, AgentAuthGuard],
})
export class IngestModule {}
