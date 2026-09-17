import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AgentAuthGuard } from '../auth/agent-auth.guard';
import { AgentLogService } from './agent-log.service';
import { UploadLogDto } from './dto/upload-log.dto';

// Agent-facing side of the on-demand log pull ("Buscar log agora" in the
// customer page) - same AgentAuthGuard bearer scheme as /v1/ingest and
// /v1/agent/releases, since it's an already-deployed agent calling in, not
// an OmniPrint operator or tenant staff.
@UseGuards(AgentAuthGuard)
@Controller('v1/agent')
export class AgentLogController {
  constructor(private readonly agentLog: AgentLogService) {}

  @Get('log-request')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async logRequest(@Req() req: any) {
    return { pending: await this.agentLog.hasPendingRequest(req.agentTokenId) };
  }

  @Post('log')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async uploadLog(@Req() req: any, @Body() dto: UploadLogDto) {
    await this.agentLog.recordUpload(req.agentTokenId, dto.content);
    return { ok: true };
  }
}
