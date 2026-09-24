import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AgentAuthGuard } from '../auth/agent-auth.guard';
import { AgentCommandService } from './agent-command.service';
import { AckCommandDto } from './dto/ack-command.dto';

// Agent-facing side of the remote commands (restart / update now / discover
// now in the customer page) - same AgentAuthGuard and poll-only model as
// AgentLogController's log-request: there's no push channel to an agent.
@UseGuards(AgentAuthGuard)
@Controller('v1/agent')
export class AgentCommandController {
  constructor(private readonly commands: AgentCommandService) {}

  @Get('command')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async command(@Req() req: any) {
    const pending = await this.commands.pendingFor(req.agentTokenId);
    return pending ?? { command: null, requestedAt: null };
  }

  @Post('command/ack')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async ack(@Req() req: any, @Body() dto: AckCommandDto) {
    return { ok: await this.commands.ack(req.agentTokenId, dto.requestedAt, dto.result) };
  }
}
