import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';

// Never select passwordHash here - these responses go straight to the
// dashboard.
const SAFE_SELECT = {
  id: true,
  email: true,
  name: true,
  customerId: true,
  customer: { select: { id: true, name: true } },
  createdAt: true,
  revokedAt: true,
} as const;

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  list(tenantId: string) {
    return this.prisma.user.findMany({
      where: { tenantId },
      select: SAFE_SELECT,
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(tenantId: string, dto: { email: string; password: string; name?: string; customerId?: string | null }) {
    if (dto.customerId) {
      const customer = await this.prisma.customer.findFirst({ where: { id: dto.customerId, tenantId } });
      if (!customer) {
        throw new NotFoundException('customer not found');
      }
    }

    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) {
      // Email is unique system-wide (see prisma/schema.prisma), not just
      // per-tenant - a second outsourcing company can't reuse an address
      // already registered to a different one.
      throw new ConflictException('email already in use');
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);
    return this.prisma.user.create({
      data: {
        tenantId,
        customerId: dto.customerId ?? null,
        email: dto.email,
        passwordHash,
        name: dto.name,
      },
      select: SAFE_SELECT,
    });
  }

  async revoke(tenantId: string, userId: string) {
    const user = await this.prisma.user.findFirst({ where: { id: userId, tenantId } });
    if (!user) {
      throw new NotFoundException('user not found');
    }
    return this.prisma.user.update({
      where: { id: userId },
      data: { revokedAt: new Date() },
      select: SAFE_SELECT,
    });
  }
}
