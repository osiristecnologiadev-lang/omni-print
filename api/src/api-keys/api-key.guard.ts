import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { hashToken } from '../auth/token.util';

// Authenticates OmniPrint's external API (api/src/external/) - same
// hash-lookup shape as AgentAuthGuard (a static bearer credential, not a
// JWT), but a structurally different trust level: an ApiKey is always
// tenant-wide (no customerId concept at all - external tooling either sees
// the whole portfolio or nothing) and always read-only (the external
// controllers this guards only ever expose GET routes - enforced by there
// being no mutating route to guard, not by a flag on the key itself).
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const authHeader: string | undefined = req.headers['authorization'];
    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('missing bearer token');
    }
    const token = authHeader.slice('Bearer '.length).trim();
    if (!token) {
      throw new UnauthorizedException('empty bearer token');
    }

    const apiKey = await this.prisma.apiKey.findUnique({ where: { tokenHash: hashToken(token) } });
    if (!apiKey || apiKey.revokedAt) {
      throw new UnauthorizedException('invalid or revoked api key');
    }

    req.tenantId = apiKey.tenantId;
    // Fire-and-forget: a slow/failed write here shouldn't hold up or break
    // the actual request this key was presented for. Best-effort "last
    // used" visibility for the Settings page, not an audit trail (see
    // AuditLogEntry for that - a read-only external API call isn't logged
    // there, same as no internal GET route is either).
    this.prisma.apiKey.update({ where: { id: apiKey.id }, data: { lastUsedAt: new Date() } }).catch(() => undefined);
    return true;
  }
}
