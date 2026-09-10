import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export type AuditActorType = 'USER' | 'PLATFORM_ADMIN';

export interface AuditLogEntryInput {
  tenantId: string | null;
  actorType: AuditActorType;
  actorId: string | null;
  actorLabel: string | null;
  action: string;
  targetType?: string;
  targetId?: string;
  targetLabel?: string;
  metadata?: Record<string, unknown>;
}

// Deliberately called from CONTROLLERS, right after the service call that
// actually mutated something succeeds - not from inside the services
// themselves. This keeps services pure/testable without mocking the audit
// log, and naturally excludes cron-driven paths (InvoicesService.
// generateDueInvoices, NotificationsService.syncAllTenants reuse the same
// service methods as their human-triggered endpoints, but are invoked with
// no HTTP request/actor at all - they never reach a controller, so they
// never produce an entry here, which is correct: they're not human actions).
export interface AuditLogPage {
  entries: Array<{
    id: string;
    actorType: AuditActorType;
    actorLabel: string | null;
    action: string;
    targetType: string | null;
    targetLabel: string | null;
    metadata: unknown;
    createdAt: Date;
  }>;
  nextCursor: string | null;
}

@Injectable()
export class AuditLogService {
  constructor(private readonly prisma: PrismaService) {}

  log(entry: AuditLogEntryInput) {
    return this.prisma.auditLogEntry.create({
      data: { ...entry, metadata: entry.metadata as Prisma.InputJsonValue | undefined },
    });
  }

  listForTenant(tenantId: string, opts: { limit: number; cursor?: string }): Promise<AuditLogPage> {
    return this.paginate({ tenantId }, opts);
  }

  listForPlatformAdmins(opts: { limit: number; cursor?: string }): Promise<AuditLogPage> {
    return this.paginate({ actorType: 'PLATFORM_ADMIN' }, opts);
  }

  // Cursor pagination by id (paired with createdAt desc as the primary
  // sort - id alone isn't chronological, but it's a stable, unique
  // tie-breaker for rows created in the same millisecond, and it's the
  // field the cursor itself addresses via Prisma's `cursor`/`skip: 1`).
  // Fetches one extra row to know whether a next page actually exists
  // without a separate count query.
  private async paginate(
    where: { tenantId: string } | { actorType: AuditActorType },
    opts: { limit: number; cursor?: string },
  ): Promise<AuditLogPage> {
    const rows = await this.prisma.auditLogEntry.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: opts.limit + 1,
      ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    });

    const hasMore = rows.length > opts.limit;
    const entries = hasMore ? rows.slice(0, opts.limit) : rows;

    return {
      entries,
      nextCursor: hasMore ? entries[entries.length - 1].id : null,
    };
  }
}
