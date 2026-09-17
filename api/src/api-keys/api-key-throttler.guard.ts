import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

// Tracks by the authenticated API key (req.apiKeyId, set by ApiKeyGuard)
// instead of the caller's IP, so a leaked key can't dodge the limit by
// rotating source addresses. Runs in addition to the global IP-keyed
// ThrottlerGuard (APP_GUARD in app.module.ts), not instead of it - both
// read the same @Throttle metadata but key their own storage bucket
// independently, so a request has to pass both checks. ApiKeyGuard must
// run before this in the controller's @UseGuards() list so req.apiKeyId
// is already set.
@Injectable()
export class ApiKeyThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    return req.apiKeyId ?? super.getTracker(req);
  }
}
