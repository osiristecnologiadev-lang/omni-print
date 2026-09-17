import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { OpsAlertGuard } from './ops-alert.guard';
import { OpsAlertService } from './ops-alerts.service';
import { ReportAlertDto } from './dto/report-alert.dto';

// web/'s own error hook (see web/src/instrumentation.ts's onRequestError)
// calls this - Next.js runs in a separate process from this API, so it has
// no direct way to reach EmailService itself. Not tenant/user auth at all,
// just OpsAlertGuard's shared secret - this only ever forwards to the same
// operator inbox api/'s own AllExceptionsFilter already alerts.
@Controller('v1/ops')
@UseGuards(OpsAlertGuard)
export class OpsAlertsController {
  constructor(private readonly opsAlertService: OpsAlertService) {}

  @Post('alert')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async report(@Body() dto: ReportAlertDto) {
    await this.opsAlertService.notify('web', `${dto.path ?? '?'} - ${dto.message}`);
    return { ok: true };
  }
}
