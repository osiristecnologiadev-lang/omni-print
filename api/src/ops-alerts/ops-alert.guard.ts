import { createHash, timingSafeEqual } from 'crypto';
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';

// A single static shared secret (OPS_ALERT_SECRET), not a per-caller
// credential like AgentToken/ApiKey - this only guards one internal
// webhook (web/'s own error hook telling api/ to send an alert email), not
// a customer-facing surface, so there's nothing to look up or revoke
// per-caller. Comparing SHA-256 hashes of both sides (fixed 32-byte
// output) rather than the raw strings directly avoids timingSafeEqual's
// length-mismatch throw while still being constant-time.
@Injectable()
export class OpsAlertGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const secret = process.env.OPS_ALERT_SECRET;
    if (!secret) {
      throw new UnauthorizedException('ops alert webhook not configured');
    }

    const req = context.switchToHttp().getRequest();
    const authHeader: string | undefined = req.headers['authorization'];
    const provided = authHeader?.startsWith('Bearer ') ? authHeader.slice('Bearer '.length).trim() : '';

    const providedHash = createHash('sha256').update(provided).digest();
    const expectedHash = createHash('sha256').update(secret).digest();
    if (!timingSafeEqual(providedHash, expectedHash)) {
      throw new UnauthorizedException('invalid ops alert secret');
    }
    return true;
  }
}
