import { Module } from '@nestjs/common';
import { AgentReleasesController } from './agent-releases.controller';
import { AgentReleasesAdminController } from './agent-releases-admin.controller';
import { AgentDownloadController } from './agent-download.controller';
import { AgentReleasesService } from './agent-releases.service';
import { AgentAuthGuard } from '../auth/agent-auth.guard';
import { PlatformAuthGuard } from '../platform/platform-auth.guard';

@Module({
  controllers: [AgentReleasesController, AgentReleasesAdminController, AgentDownloadController],
  // AgentAuthGuard/PlatformAuthGuard aren't global (see auth.module.ts /
  // platform.module.ts) - provided here directly, same pattern
  // IngestModule already uses for AgentAuthGuard. UserAuthGuard (used by
  // AgentDownloadController) IS global (AuthModule), no provider needed here.
  providers: [AgentReleasesService, AgentAuthGuard, PlatformAuthGuard],
  exports: [AgentReleasesService],
})
export class AgentReleasesModule {}
