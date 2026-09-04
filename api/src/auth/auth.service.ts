import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async login(email: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    // Same error for "no such user" and "wrong password" - don't let a login
    // attempt reveal whether an email is registered.
    if (!user || user.revokedAt) {
      throw new UnauthorizedException('invalid credentials');
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      throw new UnauthorizedException('invalid credentials');
    }

    const token = await this.jwt.signAsync({
      sub: user.id,
      tenantId: user.tenantId,
      customerId: user.customerId,
    });

    return {
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        tenantId: user.tenantId,
        customerId: user.customerId,
      },
    };
  }
}
