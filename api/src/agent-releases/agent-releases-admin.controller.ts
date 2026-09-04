import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { PlatformAuthGuard } from '../platform/platform-auth.guard';
import { AgentReleasesService } from './agent-releases.service';
import { CreateAgentReleaseDto } from './dto/create-agent-release.dto';

// Publishing a new agent build is an OmniPrint-operator action, not a
// tenant one - same guard/controller-shape as PlatformController. Memory
// storage (not disk) for the upload: releases are a few tens of MB at most,
// and the service needs the full buffer anyway to hash it before writing.
@UseGuards(PlatformAuthGuard)
@Controller('v1/platform/agent-releases')
export class AgentReleasesAdminController {
  constructor(private readonly releases: AgentReleasesService) {}

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
    @Body() dto: CreateAgentReleaseDto,
    @UploadedFiles() files: { file?: Express.Multer.File[]; installer?: Express.Multer.File[] },
  ) {
    const file = files.file?.[0];
    if (!file) {
      throw new BadRequestException('file is required');
    }
    return this.releases.create(dto, file, files.installer?.[0]);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.releases.remove(id);
  }
}
