import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';

export interface JwtPayload {
  sub: string; // user id
  tenantId: string;
  customerId: string | null;
}

// Authenticates a dashboard user (as opposed to AgentAuthGuard, which
// authenticates an on-prem agent install). Attaches req.tenantId,
// req.customerId, req.userId and req.userEmail from the JWT/DB row -
// req.customerId is the visibility scope: null means tenant-wide (see User
// model comment in prisma/schema.prisma), set means restricted to that one
// customer. req.userEmail (the row is already fetched below for the
// revokedAt check, so this is free) exists purely so controllers can
// denormalize an actor label into AuditLogEntry without a second query.
//
// Re-checks the user row on every request (not just the JWT's own
// signature/expiry): a JWT is valid for 7 days after issue, so without this
// a revoked user (see UsersService.revoke) would keep working with an
// already-issued token until it happened to expire on its own.
@Injectable()
export class UserAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const authHeader: string | undefined = req.headers['authorization'];
    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('missing bearer token');
    }
    const token = authHeader.slice('Bearer '.length).trim();

    let payload: JwtPayload;
    try {
      payload = await this.jwt.verifyAsync<JwtPayload>(token);
    } catch {
      throw new UnauthorizedException('invalid or expired token');
    }

    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || user.revokedAt) {
      throw new UnauthorizedException('user revoked or no longer exists');
    }

    req.tenantId = payload.tenantId;
    req.customerId = payload.customerId ?? null;
    req.userId = payload.sub;
    req.userEmail = user.email;
    return true;
  }
}
