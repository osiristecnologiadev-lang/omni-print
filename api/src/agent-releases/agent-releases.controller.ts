import { createReadStream } from 'fs';
import { Controller, Get, Param, Query, Req, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { AgentPlatform } from '@prisma/client';
import { AgentAuthGuard } from '../auth/agent-auth.guard';
import { AgentReleasesService } from './agent-releases.service';

// Agent-facing side of release distribution (see agent/internal/updater) -
// gated by the same per-customer AgentToken bearer scheme as /v1/ingest,
// not PlatformAuthGuard (AgentReleasesAdminController), since it's an
// already-deployed agent calling in, not an OmniPrint operator.
@UseGuards(AgentAuthGuard)
@Controller('v1/agent/releases')
export class AgentReleasesController {
  constructor(private readonly releases: AgentReleasesService) {}

  @Get('latest')
  async latest(
    @Req() req: any,
    @Query('platform') platform: AgentPlatform,
    @Query('currentVersion') currentVersion?: string,
  ) {
    // Side effect, not just a read: this is the one place an agent checks
    // in on a predictable interval (agent/internal/svc's updateTicker), so
    // it doubles as the fleet-version-visibility signal
    // (PlatformService.listAgentFleet) - see AgentToken's schema comment.
    if (currentVersion) {
      await this.releases.recordCheckin(req.agentTokenId, currentVersion);
    }

    const release = await this.releases.getLatest(platform);
    if (!release) {
      return null;
    }
    return {
      id: release.id,
      version: release.version,
      mandatory: release.mandatory,
      releaseNotes: release.releaseNotes,
      sha256: release.sha256,
      downloadUrl: `/v1/agent/releases/${release.id}/download`,
    };
  }

  @Get(':id/download')
  async download(@Param('id') id: string, @Res() res: Response) {
    const release = await this.releases.get(id);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${release.filePath.split(/[\\/]/).pop()}"`);
    res.setHeader('Content-Length', release.fileSizeBytes);
    const stream = createReadStream(release.filePath);
    stream.on('error', () => {
      if (!res.headersSent) {
        res.status(404).end();
      }
    });
    stream.pipe(res);
  }
}
