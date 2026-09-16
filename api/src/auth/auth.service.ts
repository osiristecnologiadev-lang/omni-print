import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { hashToken } from './token.util';

// 1h: long enough that a real inbox check doesn't race it, short enough that
// an old, unclicked link stops being a live credential quickly.
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly emailService: EmailService,
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

  // Always resolves, regardless of whether the email matches a real,
  // non-revoked user - same enumeration-avoidance posture as login(), just
  // expressed as "never throw" instead of "throw the same error either way"
  // since there's no successful response to distinguish here.
  async requestPasswordReset(email: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || user.revokedAt) {
      return;
    }

    const rawToken = randomBytes(32).toString('hex');
    await this.prisma.$transaction([
      // Invalidate any still-live tokens from earlier requests first - only
      // the link in the email that's about to be sent should work.
      this.prisma.passwordResetToken.updateMany({
        where: { userId: user.id, usedAt: null },
        data: { usedAt: new Date() },
      }),
      this.prisma.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash: hashToken(rawToken),
          expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
        },
      }),
    ]);

    const appUrl = process.env.APP_URL ?? 'http://localhost:3001';
    const resetLink = `${appUrl}/reset-password?token=${rawToken}`;
    await this.emailService.send({
      to: user.email,
      subject: 'Redefinir sua senha no OmniPrint',
      html: `
        <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:480px;margin:0 auto;">
          <h1 style="font-size:18px;color:#14181f;">Redefinir sua senha</h1>
          <p style="font-size:14px;color:#57606f;">Recebemos um pedido para redefinir a senha da sua conta no OmniPrint. Clique no botão abaixo para criar uma nova senha. Este link expira em 1 hora.</p>
          <p style="margin:24px 0;"><a href="${resetLink}" style="display:inline-block;background:#2547d0;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:600;">Redefinir senha</a></p>
          <p style="font-size:12.5px;color:#8a93a6;">Se você não pediu isso, pode ignorar este e-mail com segurança - sua senha não será alterada.</p>
        </div>`,
      text: `Redefinir sua senha no OmniPrint: ${resetLink}\n\nEste link expira em 1 hora. Se você não pediu isso, ignore este e-mail.`,
    });
  }

  async resetPassword(rawToken: string, newPassword: string): Promise<void> {
    const tokenHash = hashToken(rawToken);
    const resetToken = await this.prisma.passwordResetToken.findUnique({ where: { tokenHash } });
    if (!resetToken || resetToken.usedAt || resetToken.expiresAt < new Date()) {
      throw new BadRequestException('invalid or expired token');
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: resetToken.userId }, data: { passwordHash } }),
      // Mark every outstanding token for this user used, not just this one -
      // closes the window where an earlier, still-unclicked email could
      // still reset the password again right after this one succeeded.
      this.prisma.passwordResetToken.updateMany({
        where: { userId: resetToken.userId, usedAt: null },
        data: { usedAt: new Date() },
      }),
    ]);
  }
}
