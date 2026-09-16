import { Body, Controller, Param, Post, Req, UseGuards, Get } from '@nestjs/common';
import { UserAuthGuard } from '../auth/user-auth.guard';
import { assertPermission } from '../auth/permissions.util';
import { AuditLogService } from '../audit-log/audit-log.service';
import { ApiKeysService } from './api-keys.service';
import { CreateApiKeyDto } from './dto/create-api-key.dto';

// Manages the credentials for OmniPrint's own read-only external API (see
// api/src/external/) - gated on 'settings' since that's where this lives in
// the UI (Empresa > Chaves de API), not its own dedicated permission key
// (unlike 'billing' - there was no explicit ask to separate this out).
@UseGuards(UserAuthGuard)
@Controller('v1/api-keys')
export class ApiKeysController {
  constructor(
    private readonly apiKeysService: ApiKeysService,
    private readonly auditLog: AuditLogService,
  ) {}

  @Get()
  list(@Req() req: any) {
    assertPermission(req, 'settings');
    return this.apiKeysService.list(req.tenantId);
  }

  @Post()
  async create(@Req() req: any, @Body() dto: CreateApiKeyDto) {
    assertPermission(req, 'settings');
    const result = await this.apiKeysService.create(req.tenantId, dto.label);
    await this.auditLog.log({
      tenantId: req.tenantId,
      actorType: 'USER',
      actorId: req.userId,
      actorLabel: req.userEmail,
      action: 'apikey.create',
      targetType: 'ApiKey',
      targetId: result.id,
      targetLabel: result.label ?? undefined,
    });
    return result;
  }

  @Post(':id/revoke')
  async revoke(@Req() req: any, @Param('id') id: string) {
    assertPermission(req, 'settings');
    const key = await this.apiKeysService.revoke(req.tenantId, id);
    await this.auditLog.log({
      tenantId: req.tenantId,
      actorType: 'USER',
      actorId: req.userId,
      actorLabel: req.userEmail,
      action: 'apikey.revoke',
      targetType: 'ApiKey',
      targetId: key.id,
      targetLabel: key.label ?? undefined,
    });
    return key;
  }
}
