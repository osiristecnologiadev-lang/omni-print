import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AgentCommandType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { generateEnrollmentCode, formatEnrollmentCode } from '../auth/enrollment-code.util';
import { hashToken } from '../auth/token.util';

// How long a generated enrollment code stays redeemable - see
// AgentEnrollmentCode's schema comment for why the real AgentToken isn't
// generated until redemption. Long enough that "gerar o código hoje,
// instalar amanhã de manhã" still works, short enough to bound how long a
// leaked code stays exploitable.
const ENROLLMENT_CODE_TTL_MS = 24 * 60 * 60 * 1000;

// What a tenant-facing token mutation (revoke / request log / command)
// returns - never tokenHash: the raw token is only 16 digits, so its
// SHA-256 is brute-forceable offline, and handing it to any logged-in user
// would undo the whole point of storing only the hash.
const TOKEN_MUTATION_SELECT = {
  id: true,
  label: true,
  revokedAt: true,
  logRequestedAt: true,
  commandType: true,
  commandRequestedAt: true,
  commandAckedAt: true,
  commandResult: true,
} as const;

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
    const tokens = await this.prisma.agentToken.findMany({
      where: { tenantId, customerId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        label: true,
        createdAt: true,
        revokedAt: true,
        lastCheckinAt: true,
        lastSeenVersion: true,
        logRequestedAt: true,
        commandType: true,
        commandRequestedAt: true,
        commandAckedAt: true,
        commandResult: true,
        // NOT content - up to ~300KB of text per day, only fetched on
        // demand by getLog() when the "Ver log" link is actually opened,
        // not on every customer-page load. Just the latest day's upload
        // time, to show "Ver log (enviado em ...)" / pending status.
        logEntries: { orderBy: { uploadedAt: 'desc' }, take: 1, select: { uploadedAt: true } },
      },
    });
    return tokens.map(({ logEntries, ...t }) => ({ ...t, logUploadedAt: logEntries[0]?.uploadedAt ?? null }));
  }

  // No createToken here on purpose: an agent token is only ever minted by
  // redeeming an enrollment code (AgentEnrollmentService.exchange) - the
  // raw-token "manual install" path was removed so every install goes
  // through a short-lived, single-use code the tenant generated for that
  // exact customer. Tokens minted before that change keep working.

  async revokeToken(tenantId: string, customerId: string, tokenId: string) {
    await this.requireCustomer(tenantId, customerId);
    const token = await this.prisma.agentToken.findFirst({ where: { id: tokenId, tenantId, customerId } });
    if (!token) {
      throw new NotFoundException('token not found');
    }
    return this.prisma.agentToken.update({ where: { id: tokenId }, data: { revokedAt: new Date() }, select: TOKEN_MUTATION_SELECT });
  }

  // The agent notices this on its own next 2-minute check (see
  // agent/internal/svc) and uploads its log's tail - there's no push
  // channel to make it happen sooner. Re-requesting just bumps the
  // timestamp; AgentLogService.hasPendingRequest treats any AgentLogEntry
  // upload newer than logRequestedAt as "satisfied," so nothing here needs
  // to be cleared.
  async requestLog(tenantId: string, customerId: string, tokenId: string) {
    await this.requireCustomer(tenantId, customerId);
    const token = await this.prisma.agentToken.findFirst({ where: { id: tokenId, tenantId, customerId } });
    if (!token) {
      throw new NotFoundException('token not found');
    }
    return this.prisma.agentToken.update({ where: { id: tokenId }, data: { logRequestedAt: new Date() }, select: TOKEN_MUTATION_SELECT });
  }

  // Same poll-only delivery as requestLog - see AgentToken.commandType and
  // api/src/agent-command. A new request replaces whatever was there
  // (acked or not), resetting the ack/result so the page shows this one.
  async requestCommand(tenantId: string, customerId: string, tokenId: string, command: AgentCommandType) {
    await this.requireCustomer(tenantId, customerId);
    const token = await this.prisma.agentToken.findFirst({ where: { id: tokenId, tenantId, customerId, revokedAt: null } });
    if (!token) {
      throw new NotFoundException('token not found');
    }
    return this.prisma.agentToken.update({
      where: { id: tokenId },
      data: { commandType: command, commandRequestedAt: new Date(), commandAckedAt: null, commandResult: null },
      select: TOKEN_MUTATION_SELECT,
    });
  }

  // Separate from listTokens on purpose - content can be up to ~300KB,
  // only worth fetching when a human actually opens the log view. date
  // (YYYY-MM-DD) picks a specific day's upload; omitted, defaults to the
  // most recent one - same default as before AgentLogEntry existed.
  async getLog(tenantId: string, customerId: string, tokenId: string, date?: string) {
    await this.requireCustomer(tenantId, customerId);
    const token = await this.prisma.agentToken.findFirst({ where: { id: tokenId, tenantId, customerId } });
    if (!token) {
      throw new NotFoundException('token not found');
    }
    const entry = await this.prisma.agentLogEntry.findFirst({
      where: { agentTokenId: tokenId, ...(date ? { date } : {}) },
      orderBy: { uploadedAt: 'desc' },
      select: { date: true, content: true, uploadedAt: true },
    });
    return { date: entry?.date ?? null, logContent: entry?.content ?? null, logUploadedAt: entry?.uploadedAt ?? null };
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
      // Shown once - only its hash is persisted, same invariant as the
      // agent token it's later exchanged for.
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
