import { ConflictException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { hashToken } from '../auth/token.util';
import { normalizeEnrollmentCode, ENROLLMENT_CODE_LENGTH } from '../auth/enrollment-code.util';
import { generateAgentTokenDigits } from '../auth/agent-token.util';

const GENERIC_INVALID = 'invalid or expired code';

// Redeems a short-lived AgentEnrollmentCode (see its schema comment) for a
// real AgentToken - called by the Windows installer itself (see
// agent/installer/omniprint-agent.iss) before it ever writes config.yaml,
// so the installer-runner never has to type or relay a Tenant ID/long
// token. Public/unauthenticated by necessity (the installer has no
// credential yet) - see AgentEnrollmentController for the rate limit this
// leans on instead of raw secrecy alone.
@Injectable()
export class AgentEnrollmentService {
  private readonly logger = new Logger(AgentEnrollmentService.name);

  constructor(private readonly prisma: PrismaService) {}

  async exchange(rawCode: string) {
    const code = normalizeEnrollmentCode(rawCode);

    // Fails fast without a DB round-trip for obviously-garbled input - not
    // a security boundary by itself (the hash lookup below is), just avoids
    // hashing/querying for strings that can never match.
    if (code.length !== ENROLLMENT_CODE_LENGTH) {
      this.logger.warn(`enrollment attempt with malformed code (length ${code.length})`);
      throw new UnauthorizedException(GENERIC_INVALID);
    }

    const record = await this.prisma.agentEnrollmentCode.findUnique({ where: { codeHash: hashToken(code) } });

    // A single generic message for "never existed" - the brute-force-
    // relevant bucket, kept vague on purpose. The three cases below only
    // trigger AFTER a successful hash match (the caller already had to
    // know the exact code), so being specific there doesn't help someone
    // blindly guessing codes, and helps a real installer-runner tell a
    // stale/relayed code apart from a simply wrong one.
    if (!record) {
      this.logger.warn('enrollment attempt with unknown code');
      throw new UnauthorizedException(GENERIC_INVALID);
    }
    if (record.revokedAt) {
      throw new UnauthorizedException('this code has been revoked');
    }
    if (record.usedAt) {
      throw new UnauthorizedException('this code has already been used');
    }
    if (record.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException('this code has expired');
    }

    const digits = generateAgentTokenDigits();
    const label = record.label ? `Instalacao via codigo: ${record.label}` : 'Instalacao via codigo de vinculo';

    const result = await this.prisma.$transaction(async (tx) => {
      const agentToken = await tx.agentToken.create({
        data: { tenantId: record.tenantId, customerId: record.customerId, tokenHash: hashToken(digits), label },
      });

      // Conditional claim: only succeeds if this row is STILL unused and
      // unrevoked at the moment this statement runs - closes a race where
      // two near-simultaneous redemptions of the same code (a double-
      // click, a retried request) would otherwise both pass the read-time
      // checks above and each mint their own AgentToken, silently
      // violating "single use". Postgres evaluates this WHERE atomically,
      // so only one of two racing transactions can ever affect the row.
      const claim = await tx.agentEnrollmentCode.updateMany({
        where: { id: record.id, usedAt: null, revokedAt: null },
        data: { usedAt: new Date(), agentTokenId: agentToken.id },
      });
      if (claim.count === 0) {
        throw new ConflictException('code already claimed by a concurrent request');
      }

      return { tenantId: record.tenantId, digits, agentTokenId: agentToken.id };
    });

    this.logger.log(
      `enrollment code redeemed: tenant=${result.tenantId} customer=${record.customerId} agentToken=${result.agentTokenId}`,
    );

    return { tenant_id: result.tenantId, agent_token: result.digits };
  }
}
