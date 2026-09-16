import { randomUUID } from 'crypto';
import { mkdir, unlink, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { extname, join } from 'path';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateTenantDto } from './dto/update-tenant.dto';

// Same local-disk-under-storage/ posture as TicketsService/
// AgentReleasesService's own STORAGE_ROOT (see either's comment) - lives on
// the same persistent Railway volume mounted at /app/storage.
const STORAGE_ROOT = join(process.cwd(), 'storage', 'tenant-logos');
export const MAX_LOGO_BYTES = 2 * 1024 * 1024;
// PNG/JPEG only, deliberately narrower than ticket attachments - pdfkit's
// doc.image() (InvoicePdfService) can't embed WebP/GIF/SVG, and the invoice
// PDF header is the primary reason this field exists.
export const ALLOWED_LOGO_MIME_TYPES = ['image/png', 'image/jpeg'];

@Injectable()
export class TenantService {
  constructor(private readonly prisma: PrismaService) {}

  get(tenantId: string) {
    return this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
  }

  // Backs the sidebar's onboarding-incomplete badges (see TenantLayout) -
  // deliberately just two indexed existence checks (findFirst, not count),
  // cheap enough to call on every tenant-app page load unlike
  // SubscriptionService.getStatus (which makes a live Stripe call and would
  // be far too expensive to run outside its own rarely-viewed page).
  async getOnboardingStatus(tenantId: string): Promise<{ hasCustomers: boolean; hasDevices: boolean }> {
    const [customer, device] = await Promise.all([
      this.prisma.customer.findFirst({ where: { tenantId }, select: { id: true } }),
      this.prisma.device.findFirst({ where: { tenantId }, select: { id: true } }),
    ]);
    return { hasCustomers: !!customer, hasDevices: !!device };
  }

  update(tenantId: string, dto: UpdateTenantDto) {
    return this.prisma.tenant.update({ where: { id: tenantId }, data: dto });
  }

  async uploadLogo(tenantId: string, file: Express.Multer.File): Promise<{ logoFilePath: string }> {
    if (!file) {
      throw new BadRequestException('no file uploaded');
    }
    await mkdir(STORAGE_ROOT, { recursive: true });

    const previous = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { logoFilePath: true } });
    // A fresh, random-suffixed filename per upload (not a fixed
    // "<tenantId>.<ext>") - a browser <img> cache keyed by URL would
    // otherwise keep showing the OLD logo after a replace, since the
    // served path never changed.
    const storedPath = join(STORAGE_ROOT, `${tenantId}-${randomUUID()}${extname(file.originalname) || '.png'}`);
    await writeFile(storedPath, file.buffer);

    await this.prisma.tenant.update({ where: { id: tenantId }, data: { logoFilePath: storedPath } });
    if (previous.logoFilePath && existsSync(previous.logoFilePath)) {
      await unlink(previous.logoFilePath).catch(() => undefined);
    }
    return { logoFilePath: storedPath };
  }

  async removeLogo(tenantId: string): Promise<void> {
    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { logoFilePath: true } });
    await this.prisma.tenant.update({ where: { id: tenantId }, data: { logoFilePath: null } });
    if (tenant.logoFilePath && existsSync(tenant.logoFilePath)) {
      await unlink(tenant.logoFilePath).catch(() => undefined);
    }
  }

  async getLogoPath(tenantId: string): Promise<string> {
    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { logoFilePath: true } });
    if (!tenant.logoFilePath || !existsSync(tenant.logoFilePath)) {
      throw new NotFoundException('no logo uploaded');
    }
    return tenant.logoFilePath;
  }
}
