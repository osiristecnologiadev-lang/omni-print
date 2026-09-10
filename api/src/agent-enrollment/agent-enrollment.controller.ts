import { Body, Controller, Post } from '@nestjs/common';
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
  @Post('enroll')
  enroll(@Body() dto: EnrollDto) {
    return this.agentEnrollmentService.exchange(dto.code);
  }
}
