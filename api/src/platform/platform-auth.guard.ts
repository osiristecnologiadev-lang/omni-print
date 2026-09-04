import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';

interface PlatformJwtPayload {
  sub: string;
  platformAdmin: true;
}

// Authenticates OmniPrint's own operator (not any tenant's staff - see
// PlatformAdmin's comment in prisma/schema.prisma). Deliberately a
// completely separate guard/JWT shape from UserAuthGuard: even though both
// are signed with the same JWT_SECRET, a regular User's token has no
// `platformAdmin: true` claim, so it's structurally rejected here, and a
// platform admin's token has no tenantId/customerId, so it can't
// accidentally be accepted by UserAuthGuard either.
@Injectable()
export class PlatformAuthGuard implements CanActivate {
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

    let payload: PlatformJwtPayload;
    try {
      payload = await this.jwt.verifyAsync<PlatformJwtPayload>(token);
    } catch {
      throw new UnauthorizedException('invalid or expired token');
    }

    if (payload.platformAdmin !== true) {
      throw new UnauthorizedException('not a platform admin token');
    }

    const admin = await this.prisma.platformAdmin.findUnique({ where: { id: payload.sub } });
    if (!admin || admin.revokedAt) {
      throw new UnauthorizedException('platform admin revoked or no longer exists');
    }

    req.platformAdminId = payload.sub;
    return true;
  }
}
