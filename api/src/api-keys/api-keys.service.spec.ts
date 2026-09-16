import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { ApiKeysService } from './api-keys.service';
import { PrismaService } from '../prisma/prisma.service';
import { hashToken } from '../auth/token.util';

describe('ApiKeysService', () => {
  let service: ApiKeysService;
  let prisma: { apiKey: { findMany: jest.Mock; findFirst: jest.Mock; create: jest.Mock; update: jest.Mock } };

  beforeEach(async () => {
    prisma = { apiKey: { findMany: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn() } };
    const moduleRef = await Test.createTestingModule({
      providers: [ApiKeysService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(ApiKeysService);
  });

  describe('create', () => {
    it('returns the raw key exactly once, alongside its own hash in what gets stored', async () => {
      prisma.apiKey.create.mockImplementation(({ data }) => Promise.resolve({ id: 'k1', ...data }));

      const result = await service.create('t1', 'Integração BI');

      expect(result.key).toMatch(/^omp_[0-9a-f]{48}$/);
      const [[createCall]] = prisma.apiKey.create.mock.calls;
      expect(createCall.data.tokenHash).toBe(hashToken(result.key));
      expect(createCall.data.tenantId).toBe('t1');
      expect(createCall.data.label).toBe('Integração BI');
      // The response select never re-reads tokenHash back out - the raw
      // key returned to the caller comes from the local variable, not a
      // round-trip through the DB.
      expect(createCall.select).not.toHaveProperty('tokenHash');
    });
  });

  describe('revoke', () => {
    it('throws NotFoundException for a key outside this tenant', async () => {
      prisma.apiKey.findFirst.mockResolvedValue(null);
      await expect(service.revoke('t1', 'missing')).rejects.toThrow(NotFoundException);
      expect(prisma.apiKey.update).not.toHaveBeenCalled();
    });

    it('sets revokedAt for a key belonging to this tenant', async () => {
      prisma.apiKey.findFirst.mockResolvedValue({ id: 'k1', tenantId: 't1' });
      prisma.apiKey.update.mockResolvedValue({ id: 'k1', revokedAt: new Date() });

      await service.revoke('t1', 'k1');

      expect(prisma.apiKey.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'k1' }, data: { revokedAt: expect.any(Date) } }),
      );
    });
  });
});
