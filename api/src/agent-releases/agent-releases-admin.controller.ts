import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Req,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { PlatformAuthGuard } from '../platform/platform-auth.guard';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AgentReleasesService } from './agent-releases.service';
import { CreateAgentReleaseDto } from './dto/create-agent-release.dto';

// Publishing a new agent build is an OmniPrint-operator action, not a
// tenant one - same guard/controller-shape as PlatformController. Memory
// storage (not disk) for the upload: releases are a few tens of MB at most,
// and the service needs the full buffer anyway to hash it before writing.
@UseGuards(PlatformAuthGuard)
@Controller('v1/platform/agent-releases')
export class AgentReleasesAdminController {
  constructor(
    private readonly releases: AgentReleasesService,
    private readonly auditLog: AuditLogService,
  ) {}

  @Get()
  list() {
    return this.releases.list();
  }

  // 'installer' is optional - see AgentRelease.installerFilePath's schema
  // comment (Windows-only, for a human's first install via the Inno Setup
  // wizard; distinct from 'file', the bare binary the auto-updater fetches).
  @Post()
  @UseInterceptors(FileFieldsInterceptor([{ name: 'file', maxCount: 1 }, { name: 'installer', maxCount: 1 }]))
  async create(
    @Req() req: any,
    @Body() dto: CreateAgentReleaseDto,
    @UploadedFiles() files: { file?: Express.Multer.File[]; installer?: Express.Multer.File[] },
  ) {
    const file = files.file?.[0];
    if (!file) {
      throw new BadRequestException('file is required');
    }
    const release = await this.releases.create(dto, file, files.installer?.[0]);
    await this.auditLog.log({
      tenantId: null,
      actorType: 'PLATFORM_ADMIN',
      actorId: req.platformAdminId,
      actorLabel: req.platformAdminEmail,
      action: 'agent_release.publish',
      targetType: 'AgentRelease',
      targetId: release.id,
      targetLabel: `${release.platform} ${release.version}`,
      metadata: { mandatory: release.mandatory },
    });
    return release;
  }

  @Delete(':id')
  async remove(@Req() req: any, @Param('id') id: string) {
    const release = await this.releases.get(id);
    await this.releases.remove(id);
    await this.auditLog.log({
      tenantId: null,
      actorType: 'PLATFORM_ADMIN',
      actorId: req.platformAdminId,
      actorLabel: req.platformAdminEmail,
      action: 'agent_release.delete',
      targetType: 'AgentRelease',
      targetId: release.id,
      targetLabel: `${release.platform} ${release.version}`,
    });
    return { ok: true };
  }
}
