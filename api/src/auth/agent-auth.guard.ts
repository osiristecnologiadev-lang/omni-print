import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { hashToken } from './token.util';

// Resolves which tenant - and, for a customer-scoped token, which customer
// - a request belongs to from its Bearer token alone. These are the only
// tenant/customer an ingest request is ever trusted to write to - a
// tenant_id field in the request body is never used for authorization (see
// IngestController). req.customerId is null for a tenant-wide token (the
// original, pre-customer-tokens style); IngestService uses it to tag newly
// discovered devices with the right customer automatically.
@Injectable()
export class AgentAuthGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const authHeader: string | undefined = req.headers['authorization'];
    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('missing bearer token');
    }

    // Strip whitespace: the token is displayed to humans grouped like
    // "1234 5678 9012 3456" (see agent-token.util.ts) purely for
    // readability - the canonical value that's hashed/compared has no
    // spaces, so a copy-paste that keeps the spaces still works.
    const token = authHeader.slice('Bearer '.length).replace(/\s+/g, '');
    if (!token) {
      throw new UnauthorizedException('empty bearer token');
    }

    const agentToken = await this.prisma.agentToken.findUnique({
      where: { tokenHash: hashToken(token) },
    });

    if (!agentToken || agentToken.revokedAt) {
      throw new UnauthorizedException('invalid or revoked token');
    }

    req.tenantId = agentToken.tenantId;
    req.customerId = agentToken.customerId ?? null;
    req.agentTokenId = agentToken.id;
    return true;
  }
}
