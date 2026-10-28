import { ArgumentsHost, Catch, HttpException, HttpStatus } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import { OpsAlertService } from './ops-alerts.service';

// Extends Nest's own default filter and always defers to it via
// super.catch() for the actual response - this only adds a side effect
// (the email alert), it must never change what the client receives. A
// custom filter that replaced the default response shape would risk
// regressing the "no stack trace leak" property the security audit
// already confirmed for the built-in filter.
@Catch()
export class AllExceptionsFilter extends BaseExceptionFilter {
  constructor(private readonly opsAlertService: OpsAlertService) {
    super();
  }

  catch(exception: unknown, host: ArgumentsHost) {
    const status = exception instanceof HttpException ? exception.getStatus() : httpErrorStatus(exception);
    // Only genuinely unexpected errors - 4xx (validation, auth, not-found)
    // is normal traffic, not an incident worth waking someone up for.
    if (status >= 500) {
      const req = host.switchToHttp().getRequest();
      const message = exception instanceof Error ? exception.message : String(exception);
      const stack = exception instanceof Error ? exception.stack : undefined;
      void this.opsAlertService.notify('api', `${req?.method ?? '?'} ${req?.originalUrl ?? '?'} - ${message}`, stack);
    }
    super.catch(exception, host);
  }
}

// body-parser throws http-errors objects (not HttpException) carrying their
// own 4xx status - e.g. "request aborted" (400) when an agent's connection
// drops mid-upload, or "entity too large" (413). Nest's default filter
// already replies with that status; the alert must classify them the same
// way instead of treating them as 500s.
function httpErrorStatus(exception: unknown): number {
  const status = (exception as { status?: unknown; statusCode?: unknown } | null)?.status
    ?? (exception as { statusCode?: unknown } | null)?.statusCode;
  return typeof status === 'number' && status >= 400 && status < 600 ? status : HttpStatus.INTERNAL_SERVER_ERROR;
}
