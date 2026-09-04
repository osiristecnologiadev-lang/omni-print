import { Module } from '@nestjs/common';
import { AgentReleasesController } from './agent-releases.controller';
import { AgentReleasesAdminController } from './agent-releases-admin.controller';
import { AgentReleasesService } from './agent-releases.service';
import { AgentAuthGuard } from '../auth/agent-auth.guard';
import { PlatformAuthGuard } from '../platform/platform-auth.guard';

@Module({
  controllers: [AgentReleasesController, AgentReleasesAdminController],
  // AgentAuthGuard/PlatformAuthGuard aren't global (see auth.module.ts /
  // platform.module.ts) - provided here directly, same pattern
  // IngestModule already uses for AgentAuthGuard.
  providers: [AgentReleasesService, AgentAuthGuard, PlatformAuthGuard],
  exports: [AgentReleasesService],
})
export class AgentReleasesModule {}
