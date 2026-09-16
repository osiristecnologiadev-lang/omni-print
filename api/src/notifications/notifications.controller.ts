import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { UserAuthGuard } from '../auth/user-auth.guard';
import { SubscriptionGuard } from '../subscription/subscription.guard';
import { assertPermission } from '../auth/permissions.util';
import { AuditLogService } from '../audit-log/audit-log.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from './notifications.service';
import { UpdateNotificationPreferencesDto } from './dto/update-notification-preferences.dto';
import { UpdateTicketAutomationPreferencesDto } from './dto/update-ticket-automation-preferences.dto';

@UseGuards(UserAuthGuard, SubscriptionGuard)
@Controller('v1/notifications')
export class NotificationsController {
  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

  // Tenant-wide only - re-checks everything (overdue invoices, expiring
  // contracts, critical device alerts, low supplies) and upserts against
  // the caller's own tenant right now, instead of waiting for the nightly
  // cron. See NotificationsService.syncNotifications for the dedupe logic
  // that keeps this from re-surfacing something already resolved.
  @Post('sync')
  async sync(@Req() req: any) {
    assertPermission(req, 'notifications');
    return this.notificationsService.syncNotifications(req.tenantId);
  }

  // Marks one specific notification as resolved so it stops being
  // re-surfaced on future syncs, even while the underlying condition is
  // still true (e.g. a low-supply item the admin already ordered a refill
  // for). This is the "Resolver" button on the frontend.
  @Post(':id/resolve')
  async resolve(@Req() req: any, @Param('id') id: string) {
    assertPermission(req, 'notifications');
    const notification = await this.notificationsService.resolve(req.tenantId, id);
    await this.auditLog.log({
      tenantId: req.tenantId,
      actorType: 'USER',
      actorId: req.userId,
      actorLabel: req.userEmail,
      action: 'notification.resolve',
      targetType: 'Notification',
      targetId: notification.id,
      targetLabel: notification.title,
    });
    return notification;
  }

  // How many notifications the tenant hasn't opened yet - powers the nav
  // bell/badge. Deliberately its own tiny endpoint (not derived from the
  // full list) since this is called on every page load via the layout.
  @Get('unread-count')
  async unreadCount(@Req() req: any) {
    assertPermission(req, 'notifications');
    const count = await this.prisma.notification.count({ where: { tenantId: req.tenantId, readAt: null } });
    return { count };
  }

  // Unresolved items first (most recently updated first), then resolved
  // ones - so the list reads as "what needs attention" at a glance without
  // hiding history entirely.
  @Get()
  async list(@Req() req: any) {
    assertPermission(req, 'notifications');
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
    assertPermission(req, 'notifications');
    await this.prisma.notification.updateMany({
      where: { tenantId: req.tenantId, readAt: null },
      data: { readAt: new Date() },
    });
    return { ok: true };
  }

  // Gated by 'notifications' (not 'settings') - whoever manages this
  // screen manages its email preferences too, independent of who edits
  // the company's invoice-facing info in Empresa.
  @Get('preferences')
  getPreferences(@Req() req: any) {
    assertPermission(req, 'notifications');
    return this.notificationsService.getEmailPreferences(req.tenantId);
  }

  @Patch('preferences')
  async updatePreferences(@Req() req: any, @Body() dto: UpdateNotificationPreferencesDto) {
    assertPermission(req, 'notifications');
    const prefs = await this.notificationsService.updateEmailPreferences(req.tenantId, dto);
    await this.auditLog.log({
      tenantId: req.tenantId,
      actorType: 'USER',
      actorId: req.userId,
      actorLabel: req.userEmail,
      action: 'notification.update_email_preferences',
      targetType: 'Tenant',
      targetId: req.tenantId,
      metadata: prefs,
    });
    return prefs;
  }

  // Same permission gate as the email preferences above, for the same
  // reason - this lives on the same /notifications screen.
  @Get('ticket-automation-preferences')
  getTicketAutomationPreferences(@Req() req: any) {
    assertPermission(req, 'notifications');
    return this.notificationsService.getTicketAutomationPreferences(req.tenantId);
  }

  @Patch('ticket-automation-preferences')
  async updateTicketAutomationPreferences(@Req() req: any, @Body() dto: UpdateTicketAutomationPreferencesDto) {
    assertPermission(req, 'notifications');
    const prefs = await this.notificationsService.updateTicketAutomationPreferences(req.tenantId, dto);
    await this.auditLog.log({
      tenantId: req.tenantId,
      actorType: 'USER',
      actorId: req.userId,
      actorLabel: req.userEmail,
      action: 'notification.update_ticket_automation_preferences',
      targetType: 'Tenant',
      targetId: req.tenantId,
      metadata: prefs,
    });
    return prefs;
  }
}
