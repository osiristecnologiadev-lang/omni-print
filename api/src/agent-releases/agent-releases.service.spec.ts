import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AgentReleasesService } from './agent-releases.service';
import { PrismaService } from '../prisma/prisma.service';

jest.mock('fs/promises', () => ({
  mkdir: jest.fn().mockResolvedValue(undefined),
  writeFile: jest.fn().mockResolvedValue(undefined),
  rm: jest.fn().mockResolvedValue(undefined),
}));

// getLatest must rank by the stored integer columns, not the display
// string - "0.10.0" sorts *before* "0.9.0" as a string, which would pick
// the wrong "latest" release and is exactly the kind of bug that looks
// correct until a project's tenth minor release ships.
describe('AgentReleasesService', () => {
  let service: AgentReleasesService;
  let prisma: {
    agentRelease: {
      findUnique: jest.Mock;
      create: jest.Mock;
      findMany: jest.Mock;
      findFirst: jest.Mock;
      delete: jest.Mock;
    };
    agentToken: { update: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      agentRelease: {
        findUnique: jest.fn(),
        create: jest.fn(),
        findMany: jest.fn(),
        findFirst: jest.fn(),
        delete: jest.fn(),
      },
      agentToken: { update: jest.fn() },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [AgentReleasesService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = moduleRef.get(AgentReleasesService);
  });

  function makeFile(contents = 'fake-binary-contents'): Express.Multer.File {
    return {
      originalname: 'omniprint-agent.exe',
      buffer: Buffer.from(contents),
    } as Express.Multer.File;
  }

  describe('create', () => {
    it('rejects a duplicate platform+version', async () => {
      prisma.agentRelease.findUnique.mockResolvedValue({ id: 'existing' });

      await expect(
        service.create({ platform: 'WINDOWS', version: '0.2.0' } as any, makeFile()),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.agentRelease.create).not.toHaveBeenCalled();
    });

    it('parses major/minor/patch and hashes the actual uploaded bytes', async () => {
      prisma.agentRelease.findUnique.mockResolvedValue(null);
      prisma.agentRelease.create.mockResolvedValue({ id: 'new-release' });

      const file = makeFile('hello');
      await service.create(
        { platform: 'WINDOWS', version: '0.10.2', mandatory: true, releaseNotes: 'fix' } as any,
        file,
      );

      const expectedSha256 = require('crypto').createHash('sha256').update(file.buffer).digest('hex');
      expect(prisma.agentRelease.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          platform: 'WINDOWS',
          version: '0.10.2',
          majorVersion: 0,
          minorVersion: 10,
          patchVersion: 2,
          sha256: expectedSha256,
          fileSizeBytes: file.buffer.length,
          mandatory: true,
          releaseNotes: 'fix',
        }),
      });
    });
  });

  describe('getLatest', () => {
    it('orders by the integer version columns, not the display string', async () => {
      prisma.agentRelease.findFirst.mockResolvedValue({ id: 'r1', version: '0.10.0' });

      await service.getLatest('WINDOWS' as any);

      expect(prisma.agentRelease.findFirst).toHaveBeenCalledWith({
        where: { platform: 'WINDOWS' },
        orderBy: [{ majorVersion: 'desc' }, { minorVersion: 'desc' }, { patchVersion: 'desc' }],
      });
    });
  });

  // Regression: the download page used getLatest, so once a binary-only
  // release (no installer) became the newest, every tenant saw "no
  // installer available" even though older releases had one.
  describe('getLatestWithInstaller', () => {
    it('only considers releases that have an installer, newest version first', async () => {
      prisma.agentRelease.findFirst.mockResolvedValue({ id: 'r1', version: '0.1.6' });

      await service.getLatestWithInstaller('WINDOWS' as any);

      expect(prisma.agentRelease.findFirst).toHaveBeenCalledWith({
        where: { platform: 'WINDOWS', installerFilePath: { not: null } },
        orderBy: [{ majorVersion: 'desc' }, { minorVersion: 'desc' }, { patchVersion: 'desc' }],
      });
    });
  });

  describe('get', () => {
    it('throws NotFoundException for an unknown id', async () => {
      prisma.agentRelease.findUnique.mockResolvedValue(null);

      await expect(service.get('missing')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('recordCheckin', () => {
    it('updates the calling token with the reported version and a fresh timestamp', async () => {
      await service.recordCheckin('token-1', '0.3.0');

      expect(prisma.agentToken.update).toHaveBeenCalledWith({
        where: { id: 'token-1' },
        data: { lastSeenVersion: '0.3.0', lastCheckinAt: expect.any(Date) },
      });
    });
  });
});
