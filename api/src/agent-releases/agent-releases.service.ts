import { createHash } from 'crypto';
import { mkdir, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AgentPlatform } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAgentReleaseDto } from './dto/create-agent-release.dto';

// No blob storage exists anywhere in this codebase (unlike invoice PDFs,
// which are generated on the fly - see InvoicePdfService - a release is a
// real uploaded binary that has to live somewhere between publish and
// download). Local disk under storage/agent-releases/ is the simplest thing
// that works at this project's current local-only stage (see
// project-omniprint-overview's "production infra" item, not started yet) -
// swapping to real blob storage later only touches this file.
const STORAGE_ROOT = join(process.cwd(), 'storage', 'agent-releases');

function parseVersion(version: string): { major: number; minor: number; patch: number } {
  const [major, minor, patch] = version.split('.').map(Number);
  return { major, minor, patch };
}

@Injectable()
export class AgentReleasesService {
  constructor(private readonly prisma: PrismaService) {}

  // installer is optional (Windows releases only - see the schema comment
  // on AgentRelease.installerFilePath) - a logged-in tenant user downloads
  // it for a first install (AgentDownloadController); the bare `file` is
  // what the auto-updater fetches for an already-installed agent.
  async create(dto: CreateAgentReleaseDto, file: Express.Multer.File, installer?: Express.Multer.File) {
    const existing = await this.prisma.agentRelease.findUnique({
      where: { platform_version: { platform: dto.platform, version: dto.version } },
    });
    if (existing) {
      throw new ConflictException(`${dto.platform} ${dto.version} already published`);
    }

    const { major, minor, patch } = parseVersion(dto.version);
    // Computed from the actual uploaded bytes, never trusted from the
    // client - a caller could otherwise publish a mismatched checksum that
    // every agent would then blindly accept as "verified".
    const sha256 = createHash('sha256').update(file.buffer).digest('hex');

    const dir = join(STORAGE_ROOT, dto.platform.toLowerCase(), dto.version);
    await mkdir(dir, { recursive: true });
    const filePath = join(dir, file.originalname);
    await writeFile(filePath, file.buffer);

    let installerFilePath: string | null = null;
    let installerFileSizeBytes: number | null = null;
    if (installer) {
      installerFilePath = join(dir, installer.originalname);
      await writeFile(installerFilePath, installer.buffer);
      installerFileSizeBytes = installer.buffer.length;
    }

    return this.prisma.agentRelease.create({
      data: {
        platform: dto.platform,
        version: dto.version,
        majorVersion: major,
        minorVersion: minor,
        patchVersion: patch,
        filePath,
        sha256,
        fileSizeBytes: file.buffer.length,
        mandatory: dto.mandatory ?? false,
        releaseNotes: dto.releaseNotes,
        installerFilePath,
        installerFileSizeBytes,
      },
    });
  }

  list() {
    return this.prisma.agentRelease.findMany({ orderBy: { createdAt: 'desc' } });
  }

  async get(id: string) {
    const release = await this.prisma.agentRelease.findUnique({ where: { id } });
    if (!release) {
      throw new NotFoundException('release not found');
    }
    return release;
  }

  async remove(id: string) {
    const release = await this.get(id);
    await this.prisma.agentRelease.delete({ where: { id } });
    // Best-effort - a release row disappearing matters more than a leftover
    // file on disk, so a failed unlink doesn't roll back the delete.
    await rm(release.filePath, { force: true }).catch(() => undefined);
    if (release.installerFilePath) {
      await rm(release.installerFilePath, { force: true }).catch(() => undefined);
    }
  }

  // Highest (major,minor,patch) for the platform, ordered on the integer
  // columns - not the display string, which would rank "0.10.0" below
  // "0.9.0".
  getLatest(platform: AgentPlatform) {
    return this.prisma.agentRelease.findFirst({
      where: { platform },
      orderBy: [{ majorVersion: 'desc' }, { minorVersion: 'desc' }, { patchVersion: 'desc' }],
    });
  }

  // What a tenant downloads for a first install - the newest release that
  // actually has an installer attached, not simply the newest release:
  // many releases ship only the auto-update binary (no Inno Setup on the
  // build machine), and pointing the download page at getLatest made it
  // say "no installer available" for every tenant from v0.1.7 onward.
  getLatestWithInstaller(platform: AgentPlatform) {
    return this.prisma.agentRelease.findFirst({
      where: { platform, installerFilePath: { not: null } },
      orderBy: [{ majorVersion: 'desc' }, { minorVersion: 'desc' }, { patchVersion: 'desc' }],
    });
  }

  // Observational only (see AgentToken.lastSeenVersion's schema comment) -
  // called from AgentReleasesController.latest on every version-check an
  // agent makes.
  recordCheckin(agentTokenId: string, version: string) {
    return this.prisma.agentToken.update({
      where: { id: agentTokenId },
      data: { lastSeenVersion: version, lastCheckinAt: new Date() },
    });
  }
}
