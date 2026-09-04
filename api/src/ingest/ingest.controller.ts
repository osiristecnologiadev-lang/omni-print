import { Body, Controller, Logger, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AgentAuthGuard } from '../auth/agent-auth.guard';
import { IngestPayloadDto } from './dto/ingest-payload.dto';
import { IngestService } from './ingest.service';

@Controller('v1')
export class IngestController {
  private readonly logger = new Logger(IngestController.name);

  constructor(private readonly ingestService: IngestService) {}

  // Tighter than the global default - each request re-checks the agent
  // token (AgentAuthGuard), so this is also a credential-guessing surface,
  // and the 16-digit token has less entropy than a full random secret by
  // design (see prisma/schema.prisma's AgentToken comment).
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @UseGuards(AgentAuthGuard)
  @Post('ingest')
  async ingest(@Req() req: any, @Body() body: IngestPayloadDto) {
    // req.tenantId comes from the authenticated token (AgentAuthGuard), not
    // from the body - a mismatch here means the wrong token is configured
    // somewhere, not a reason to trust the body's claim instead.
    if (body.tenant_id && body.tenant_id !== req.tenantId) {
      this.logger.warn(
        `ignoring tenant_id in request body (${body.tenant_id}) - using token's tenant (${req.tenantId})`,
      );
    }
    return this.ingestService.ingest(req.tenantId, req.customerId, body.metrics ?? []);
  }
}
