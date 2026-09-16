import { randomBytes } from 'crypto';
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { hashToken } from '../auth/token.util';

const SAFE_SELECT = { id: true, label: true, createdAt: true, lastUsedAt: true, revokedAt: true } as const;

@Injectable()
export class ApiKeysService {
  constructor(private readonly prisma: PrismaService) {}

  list(tenantId: string) {
    return this.prisma.apiKey.findMany({ where: { tenantId }, select: SAFE_SELECT, orderBy: { createdAt: 'desc' } });
  }

  async create(tenantId: string, label?: string) {
    // "omp_" prefix (same spirit as Stripe/GitHub-style keys) - purely
    // cosmetic, makes a pasted key recognizable at a glance in a config
    // file or log line, no parsing depends on it.
    const rawKey = `omp_${randomBytes(24).toString('hex')}`;
    const created = await this.prisma.apiKey.create({
      data: { tenantId, tokenHash: hashToken(rawKey), label },
      select: SAFE_SELECT,
    });
    return { ...created, key: rawKey };
  }

  async revoke(tenantId: string, id: string) {
    const key = await this.prisma.apiKey.findFirst({ where: { id, tenantId } });
    if (!key) {
      throw new NotFoundException('api key not found');
    }
    return this.prisma.apiKey.update({ where: { id }, data: { revokedAt: new Date() }, select: SAFE_SELECT });
  }
}
