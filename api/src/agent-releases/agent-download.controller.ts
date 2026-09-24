import { createReadStream } from 'fs';
import { Controller, Get, NotFoundException, Param, Query, Req, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { AgentPlatform } from '@prisma/client';
import { UserAuthGuard } from '../auth/user-auth.guard';
import { SubscriptionGuard } from '../subscription/subscription.guard';
import { assertPermission } from '../auth/permissions.util';
import { AgentReleasesService } from './agent-releases.service';

// Tenant-facing side of release distribution - a logged-in outsourcing-
// company user downloading the installer for a *first* install, gated by
// UserAuthGuard (a real dashboard session), not AgentAuthGuard
// (agent-releases.controller.ts - an already-deployed agent's own token,
// which a brand new install doesn't have yet). Tenant-wide only: setting up
// a new agent install is an administrative action, same access rule as
// customer/contract management elsewhere in this app.
@UseGuards(UserAuthGuard, SubscriptionGuard)
@Controller('v1/agent-download')
export class AgentDownloadController {
  constructor(private readonly releases: AgentReleasesService) {}

  @Get('latest')
  async latest(@Req() req: any, @Query('platform') platform: AgentPlatform) {
    assertPermission(req, 'agent');
    // The installer is self-updating after install, so an older installer
    // is fine to hand out - the agent moves to the latest version on its
    // own first update check.
    const release = await this.releases.getLatestWithInstaller(platform);
    if (!release) {
      return null;
    }
    return {
      id: release.id,
      version: release.version,
      releaseNotes: release.releaseNotes,
      hasInstaller: release.installerFilePath != null,
      installerSizeBytes: release.installerFileSizeBytes,
    };
  }

  @Get(':id/installer')
  async downloadInstaller(@Req() req: any, @Param('id') id: string, @Res() res: Response) {
    assertPermission(req, 'agent');
    const release = await this.releases.get(id);
    if (!release.installerFilePath) {
      throw new NotFoundException('no installer uploaded for this release');
    }
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${release.installerFilePath.split(/[\\/]/).pop()}"`,
    );
    res.setHeader('Content-Length', release.installerFileSizeBytes ?? 0);
    const stream = createReadStream(release.installerFilePath);
    stream.on('error', () => {
      if (!res.headersSent) {
        res.status(404).end();
      }
    });
    stream.pipe(res);
  }
}
