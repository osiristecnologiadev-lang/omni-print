import { createReadStream } from 'fs';
import { extname } from 'path';
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Patch,
  Post,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { UserAuthGuard } from '../auth/user-auth.guard';
import { assertPermission } from '../auth/permissions.util';
import { AuditLogService } from '../audit-log/audit-log.service';
import { TenantService, ALLOWED_LOGO_MIME_TYPES, MAX_LOGO_BYTES } from './tenant.service';
import { UpdateTenantDto } from './dto/update-tenant.dto';

const LOGO_CONTENT_TYPE: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' };

// Always operates on the caller's OWN tenant (from the JWT, via UserAuthGuard)
// - there's no tenant id in these routes, so there's nothing to check against
// another tenant's data. Tenant-wide only: a customer-scoped login has no
// business editing (or needing) its outsourcing provider's own billing
// contact info.
@UseGuards(UserAuthGuard)
@Controller('v1/tenant')
export class TenantController {
  constructor(
    private readonly tenantService: TenantService,
    private readonly auditLog: AuditLogService,
  ) {}

  @Get()
  get(@Req() req: any) {
    return this.tenantService.get(req.tenantId);
  }

  @Get('onboarding-status')
  getOnboardingStatus(@Req() req: any) {
    return this.tenantService.getOnboardingStatus(req.tenantId);
  }

  @Patch()
  async update(@Req() req: any, @Body() dto: UpdateTenantDto) {
    assertPermission(req, 'settings');
    const tenant = await this.tenantService.update(req.tenantId, dto);
    await this.auditLog.log({
      tenantId: req.tenantId,
      actorType: 'USER',
      actorId: req.userId,
      actorLabel: req.userEmail,
      action: 'tenant.update',
      targetType: 'Tenant',
      targetId: tenant.id,
      targetLabel: tenant.name,
    });
    return tenant;
  }

  @Get('logo')
  async getLogo(@Req() req: any, @Res() res: Response) {
    const logoFilePath = await this.tenantService.getLogoPath(req.tenantId);
    const contentType = LOGO_CONTENT_TYPE[extname(logoFilePath).toLowerCase()] ?? 'application/octet-stream';
    res.setHeader('Content-Type', contentType);
    createReadStream(logoFilePath).pipe(res);
  }

  @Post('logo')
  @UseInterceptors(FileInterceptor('logo', { limits: { fileSize: MAX_LOGO_BYTES } }))
  async uploadLogo(@Req() req: any, @UploadedFile() file: Express.Multer.File) {
    assertPermission(req, 'settings');
    if (!file || !ALLOWED_LOGO_MIME_TYPES.includes(file.mimetype)) {
      // No fileFilter on the interceptor (unlike TicketsController's) -
      // this route only ever takes one required file, so rejecting here
      // with a real error is more useful than TicketsController's
      // silent-drop-the-attachment behavior (which fits a form where the
      // file is one optional field among several).
      throw new BadRequestException('invalid or missing file - only PNG/JPEG accepted');
    }
    const result = await this.tenantService.uploadLogo(req.tenantId, file);
    await this.auditLog.log({
      tenantId: req.tenantId,
      actorType: 'USER',
      actorId: req.userId,
      actorLabel: req.userEmail,
      action: 'tenant.logo_upload',
      targetType: 'Tenant',
      targetId: req.tenantId,
    });
    return result;
  }

  @Delete('logo')
  async deleteLogo(@Req() req: any) {
    assertPermission(req, 'settings');
    await this.tenantService.removeLogo(req.tenantId);
    await this.auditLog.log({
      tenantId: req.tenantId,
      actorType: 'USER',
      actorId: req.userId,
      actorLabel: req.userEmail,
      action: 'tenant.logo_remove',
      targetType: 'Tenant',
      targetId: req.tenantId,
    });
    return { ok: true };
  }
}
