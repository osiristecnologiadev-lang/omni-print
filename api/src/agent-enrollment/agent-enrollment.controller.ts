import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { EnrollDto } from './dto/enroll.dto';
import { AgentEnrollmentService } from './agent-enrollment.service';

@Controller('v1/agent')
export class AgentEnrollmentController {
  constructor(private readonly agentEnrollmentService: AgentEnrollmentService) {}

  // Tighter than ingest's 20/min: a compromised/guessed code hands over a
  // full long-lived AgentToken (see AgentEnrollmentService), a higher-value
  // target than a login guess - matches /v1/auth/login and /v1/signup's
  // 5/min instead.
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  // Nest defaults POST to 201, but the Inno Setup installer's ExchangeCode
  // (agent/installer/omniprint-agent.iss) only ever checks for 200 - forced
  // explicitly rather than teaching the installer to accept both, since the
  // installer is compiled/distributed and can't be patched without a new
  // release, while this is a one-line server-side fix.
  @HttpCode(HttpStatus.OK)
  @Post('enroll')
  enroll(@Body() dto: EnrollDto) {
    return this.agentEnrollmentService.exchange(dto.code);
  }
}
