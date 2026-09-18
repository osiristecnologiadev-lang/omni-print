import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';

// How long a day's log entry survives before pruneOldLogs deletes it -
// chosen with the user as "enough for a normal monthly support cycle,
// discard the rest" rather than keeping every day forever.
const RETENTION_DAYS = 30;

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

@Injectable()
export class AgentLogService {
  private readonly logger = new Logger(AgentLogService.name);

  constructor(private readonly prisma: PrismaService) {}

  // "Pending" = a request exists and hasn't been satisfied by a newer
  // upload yet - checked on every one of the agent's own 2-minute ticks
  // (agent/internal/svc), so this stays a cheap couple of single-row
  // reads. The upload that satisfies a request isn't necessarily today's
  // entry (e.g. the daily ticker firing right after) - any entry newer
  // than the request counts, matching how logRequestedAt/logUploadedAt
  // compared before AgentLogEntry existed.
  async hasPendingRequest(agentTokenId: string): Promise<boolean> {
    const token = await this.prisma.agentToken.findUnique({
      where: { id: agentTokenId },
      select: { logRequestedAt: true },
    });
    if (!token?.logRequestedAt) return false;

    const latest = await this.prisma.agentLogEntry.findFirst({
      where: { agentTokenId },
      orderBy: { uploadedAt: 'desc' },
      select: { uploadedAt: true },
    });
    return !latest || latest.uploadedAt < token.logRequestedAt;
  }

  // Upsert by (agentTokenId, date): a restart, a second manual click, and
  // the daily ticker can all upload the same calendar day more than
  // once - each just refreshes that one row instead of piling up noise.
  async recordUpload(agentTokenId: string, date: string, content: string) {
    return this.prisma.agentLogEntry.upsert({
      where: { agentTokenId_date: { agentTokenId, date } },
      create: { agentTokenId, date, content },
      update: { content, uploadedAt: new Date() },
    });
  }

  // Tenant-wide, filterable by customer and/or a specific day - backs the
  // panel's dedicated Logs screen. Deliberately excludes `content` (can be
  // up to ~300KB each) - same reasoning as CustomersService.listTokens not
  // including it, only fetched when a specific entry is actually opened.
  async listForTenant(tenantId: string, filters: { customerId?: string; date?: string }) {
    return this.prisma.agentLogEntry.findMany({
      where: {
        agentToken: {
          tenantId,
          ...(filters.customerId ? { customerId: filters.customerId } : {}),
        },
        ...(filters.date ? { date: filters.date } : {}),
      },
      orderBy: [{ date: 'desc' }, { uploadedAt: 'desc' }],
      select: {
        id: true,
        date: true,
        uploadedAt: true,
        agentToken: { select: { id: true, label: true, customer: { select: { id: true, name: true } } } },
      },
    });
  }

  async getEntry(tenantId: string, entryId: string) {
    return this.prisma.agentLogEntry.findFirst({
      where: { id: entryId, agentToken: { tenantId } },
      select: { id: true, date: true, content: true, uploadedAt: true },
    });
  }

  // Runs regardless of whether anyone's Logs screen is even open -
  // storage isn't bounded otherwise, since every tenant's every agent
  // uploads once a day (see agent/internal/svc's dailyUploadTicker).
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async pruneOldLogs() {
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const { count } = await this.prisma.agentLogEntry.deleteMany({
      where: { date: { lt: isoDate(cutoff) } },
    });
    if (count > 0) {
      this.logger.log(`pruned ${count} agent log entr${count === 1 ? 'y' : 'ies'} older than ${RETENTION_DAYS} days`);
    }
  }
}
