import { Controller, ForbiddenException, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { UserAuthGuard } from '../auth/user-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from './notifications.service';

@UseGuards(UserAuthGuard)
@Controller('v1/notifications')
export class NotificationsController {
  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly prisma: PrismaService,
  ) {}

  // Tenant-wide only - re-checks everything (overdue invoices, expiring
  // contracts, critical device alerts, low supplies) and upserts against
  // the caller's own tenant right now, instead of waiting for the nightly
  // cron. See NotificationsService.syncNotifications for the dedupe logic
  // that keeps this from re-surfacing something already resolved.
  @Post('sync')
  async sync(@Req() req: any) {
    if (req.customerId) {
      throw new ForbiddenException('only tenant-wide users can do this');
    }
    return this.notificationsService.syncNotifications(req.tenantId);
  }

  // Marks one specific notification as resolved so it stops being
  // re-surfaced on future syncs, even while the underlying condition is
  // still true (e.g. a low-supply item the admin already ordered a refill
  // for). This is the "Resolver" button on the frontend.
  @Post(':id/resolve')
  async resolve(@Req() req: any, @Param('id') id: string) {
    if (req.customerId) {
      throw new ForbiddenException('only tenant-wide users can do this');
    }
    return this.notificationsService.resolve(req.tenantId, id);
  }

  // How many notifications the tenant hasn't opened yet - powers the nav
  // bell/badge. Deliberately its own tiny endpoint (not derived from the
  // full list) since this is called on every page load via the layout.
  @Get('unread-count')
  async unreadCount(@Req() req: any) {
    if (req.customerId) {
      throw new ForbiddenException('only tenant-wide users can do this');
    }
    const count = await this.prisma.notification.count({ where: { tenantId: req.tenantId, readAt: null } });
    return { count };
  }

  // Unresolved items first (most recently updated first), then resolved
  // ones - so the list reads as "what needs attention" at a glance without
  // hiding history entirely.
  @Get()
  async list(@Req() req: any) {
    if (req.customerId) {
      throw new ForbiddenException('only tenant-wide users can do this');
    }
    return this.prisma.notification.findMany({
      where: { tenantId: req.tenantId },
      orderBy: [{ resolvedAt: { sort: 'asc', nulls: 'first' } }, { updatedAt: 'desc' }],
      take: 100,
    });
  }

  // Marks every unread notification for the tenant as read in one go -
  // called when someone opens the dedicated /notifications screen (see the
  // frontend page), not as a per-item action.
  @Post('mark-all-read')
  async markAllRead(@Req() req: any) {
    if (req.customerId) {
      throw new ForbiddenException('only tenant-wide users can do this');
    }
    await this.prisma.notification.updateMany({
      where: { tenantId: req.tenantId, readAt: null },
      data: { readAt: new Date() },
    });
    return { ok: true };
  }
}
