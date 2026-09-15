import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { generateAgentTokenDigits, formatAgentTokenDigits } from '../auth/agent-token.util';
import { generateEnrollmentCode, formatEnrollmentCode } from '../auth/enrollment-code.util';
import { hashToken } from '../auth/token.util';

// How long a generated enrollment code stays redeemable - see
// AgentEnrollmentCode's schema comment for why the real AgentToken isn't
// generated until redemption. Long enough that "gerar o código hoje,
// instalar amanhã de manhã" still works, short enough to bound how long a
// leaked code stays exploitable.
const ENROLLMENT_CODE_TTL_MS = 24 * 60 * 60 * 1000;

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
      notifyEmail?: string | null;
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

  // Codes are listed without their hash or raw value - same reasoning as
  // listTokens. agentTokenId is included so the UI can show "used, minted
  // token X" once redeemed.
  async listEnrollmentCodes(tenantId: string, customerId: string) {
    await this.requireCustomer(tenantId, customerId);
    return this.prisma.agentEnrollmentCode.findMany({
      where: { tenantId, customerId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        label: true,
        createdAt: true,
        expiresAt: true,
        usedAt: true,
        revokedAt: true,
        agentTokenId: true,
      },
    });
  }

  async createEnrollmentCode(tenantId: string, customerId: string, label?: string) {
    await this.requireCustomer(tenantId, customerId);

    const code = generateEnrollmentCode();
    const record = await this.prisma.agentEnrollmentCode.create({
      data: {
        tenantId,
        customerId,
        codeHash: hashToken(code),
        label,
        expiresAt: new Date(Date.now() + ENROLLMENT_CODE_TTL_MS),
      },
    });

    return {
      id: record.id,
      label: record.label,
      createdAt: record.createdAt,
      expiresAt: record.expiresAt,
      // Shown once - only its hash is persisted, same invariant as
      // createToken's raw token.
      code: formatEnrollmentCode(code),
    };
  }

  async revokeEnrollmentCode(tenantId: string, customerId: string, codeId: string) {
    await this.requireCustomer(tenantId, customerId);
    const record = await this.prisma.agentEnrollmentCode.findFirst({ where: { id: codeId, tenantId, customerId } });
    if (!record) {
      throw new NotFoundException('enrollment code not found');
    }
    // A used code already did its job - the AgentToken it minted is what
    // actually grants access now, and revoking this row wouldn't affect
    // that token at all. Block it with a clear error rather than silently
    // no-op'ing, so an admin doesn't walk away thinking they'd cut off
    // access - point them at revoking the resulting token instead.
    if (record.usedAt) {
      throw new ConflictException('this code has already been used - revoke the resulting agent token instead');
    }
    return this.prisma.agentEnrollmentCode.update({ where: { id: codeId }, data: { revokedAt: new Date() } });
  }
}
