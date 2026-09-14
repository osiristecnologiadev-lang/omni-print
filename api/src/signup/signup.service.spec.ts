import { ConflictException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { SignupService } from './signup.service';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { JwtService } from '@nestjs/jwt';

describe('SignupService.register', () => {
  let service: SignupService;
  let prisma: { user: { findUnique: jest.Mock }; tenant: { create: jest.Mock } };
  let usersService: { create: jest.Mock };
  let jwt: { signAsync: jest.Mock };

  beforeEach(async () => {
    prisma = { user: { findUnique: jest.fn() }, tenant: { create: jest.fn() } };
    usersService = { create: jest.fn() };
    jwt = { signAsync: jest.fn().mockResolvedValue('signed-jwt') };

    const moduleRef = await Test.createTestingModule({
      providers: [
        SignupService,
        { provide: PrismaService, useValue: prisma },
        { provide: UsersService, useValue: usersService },
        { provide: JwtService, useValue: jwt },
      ],
    }).compile();

    service = moduleRef.get(SignupService);
  });

  // The real bug this guards against: creating the Tenant row before
  // checking email uniqueness would leave an orphaned zero-user Tenant
  // behind every time someone re-submits the signup form with an email
  // that's already registered (a common case, not an edge case).
  it('rejects a duplicate email WITHOUT creating a Tenant row', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'existing-user' });

    await expect(
      service.register({ companyName: 'Acme', email: 'taken@example.com', password: 'longenough' }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(prisma.tenant.create).not.toHaveBeenCalled();
    expect(usersService.create).not.toHaveBeenCalled();
  });

  it('creates a tenant + user and returns an auto-login token', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.tenant.create.mockResolvedValue({ id: 'tenant-1', name: 'Acme' });
    usersService.create.mockResolvedValue({ id: 'user-1', email: 'new@example.com', name: undefined, customerId: null });

    const result = await service.register({ companyName: 'Acme', email: 'new@example.com', password: 'longenough' });

    expect(prisma.tenant.create).toHaveBeenCalledWith({
      data: { name: 'Acme', trialEndsAt: expect.any(Date) },
    });
    expect(usersService.create).toHaveBeenCalledWith('tenant-1', {
      email: 'new@example.com',
      password: 'longenough',
      name: undefined,
      customerId: null,
    });
    expect(jwt.signAsync).toHaveBeenCalledWith({ sub: 'user-1', tenantId: 'tenant-1', customerId: null });
    expect(result).toEqual({
      token: 'signed-jwt',
      user: { id: 'user-1', email: 'new@example.com', name: undefined, customerId: null, tenantId: 'tenant-1' },
    });
  });
});
