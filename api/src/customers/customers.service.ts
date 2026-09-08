import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { generateAgentTokenDigits, formatAgentTokenDigits } from '../auth/agent-token.util';
import { hashToken } from '../auth/token.util';

@Injectable()
export class CustomersService {
  constructor(private readonly prisma: PrismaService) {}

  list(tenantId: string) {
    return this.prisma.customer.findMany({
      where: { tenantId },
      orderBy: { name: 'asc' },
      include: { _count: { select: { devices: true } } },
    });
  }

  create(tenantId: string, name: string) {
    return this.prisma.customer.create({ data: { tenantId, name } });
  }

  async get(tenantId: string, customerId: string) {
    return this.requireCustomer(tenantId, customerId);
  }

  async update(
    tenantId: string,
    customerId: string,
    data: {
      document?: string;
      address?: string;
      slaHoursLow?: number | null;
      slaHoursMedium?: number | null;
      slaHoursHigh?: number | null;
      slaHoursUrgent?: number | null;
    },
  ) {
    await this.requireCustomer(tenantId, customerId);
    return this.prisma.customer.update({ where: { id: customerId }, data });
  }

  private async requireCustomer(tenantId: string, customerId: string) {
    const customer = await this.prisma.customer.findFirst({ where: { id: customerId, tenantId } });
    if (!customer) {
      throw new NotFoundException('customer not found');
    }
    return customer;
  }

  // Tokens are listed without their hash or raw value - only the raw value
  // (shown once, here at creation) can ever authenticate as this customer.
  // lastCheckinAt/lastSeenVersion (set on every real update-check an agent
  // makes - see AgentReleasesService.recordCheckin) are included so the
  // tenant can tell a token is actually in use, without needing the value
  // itself back.
  async listTokens(tenantId: string, customerId: string) {
    await this.requireCustomer(tenantId, customerId);
    return this.prisma.agentToken.findMany({
      where: { tenantId, customerId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        label: true,
        createdAt: true,
        revokedAt: true,
        lastCheckinAt: true,
        lastSeenVersion: true,
      },
    });
  }

  async createToken(tenantId: string, customerId: string, label?: string) {
    await this.requireCustomer(tenantId, customerId);

    const digits = generateAgentTokenDigits();
    const agentToken = await this.prisma.agentToken.create({
      data: { tenantId, customerId, tokenHash: hashToken(digits), label },
    });

    return {
      id: agentToken.id,
      label: agentToken.label,
      createdAt: agentToken.createdAt,
      // Shown once - the caller must copy this into the client's
      // agent/config.yaml now. It cannot be retrieved again after this
      // response (only its hash is persisted).
      token: formatAgentTokenDigits(digits),
    };
  }

  async revokeToken(tenantId: string, customerId: string, tokenId: string) {
    await this.requireCustomer(tenantId, customerId);
    const token = await this.prisma.agentToken.findFirst({ where: { id: tokenId, tenantId, customerId } });
    if (!token) {
      throw new NotFoundException('token not found');
    }
    return this.prisma.agentToken.update({ where: { id: tokenId }, data: { revokedAt: new Date() } });
  }
}
