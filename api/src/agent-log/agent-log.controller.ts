import { Body, Controller, Get, NotFoundException, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AgentAuthGuard } from '../auth/agent-auth.guard';
import { UserAuthGuard } from '../auth/user-auth.guard';
import { SubscriptionGuard } from '../subscription/subscription.guard';
import { assertPermission } from '../auth/permissions.util';
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
    await this.agentLog.recordUpload(req.agentTokenId, dto.date, dto.content);
    return { ok: true };
  }
}

// Tenant-facing dedicated Logs screen - cross-customer, filterable by
// customer and/or date, unlike the per-token "Ver log" link on the
// customer page itself (CustomersController.getLog). Same tenant-wide-only
// reasoning as AuditLogController: a customer-scoped session has no
// business browsing another customer's agent logs.
@UseGuards(UserAuthGuard, SubscriptionGuard)
@Controller('v1/agent-logs')
export class AgentLogsController {
  constructor(private readonly agentLog: AgentLogService) {}

  @Get()
  list(@Req() req: any, @Query('customerId') customerId?: string, @Query('date') date?: string) {
    assertPermission(req, 'agent_logs');
    return this.agentLog.listForTenant(req.tenantId, { customerId, date });
  }

  @Get(':id')
  async get(@Req() req: any, @Param('id') id: string) {
    assertPermission(req, 'agent_logs');
    const entry = await this.agentLog.getEntry(req.tenantId, id);
    if (!entry) {
      throw new NotFoundException('log entry not found');
    }
    return entry;
  }
}
