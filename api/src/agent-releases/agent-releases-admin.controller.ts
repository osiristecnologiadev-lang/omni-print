import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
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

  @Post()
  @UseInterceptors(FileInterceptor('file'))
  async create(@Body() dto: CreateAgentReleaseDto, @UploadedFile() file?: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('file is required');
    }
    return this.releases.create(dto, file);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.releases.remove(id);
  }
}
