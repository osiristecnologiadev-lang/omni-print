import { ConflictException, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { trialEndsAtFromNow } from '../subscription/trial.util';
import { TENANT_ONLY_PERMISSION_KEYS } from '../auth/permissions.util';
import { SignupDto } from './dto/signup.dto';

// Public tenant self-registration - the first outsourcing-company user for
// a brand new Tenant, created without any platform-admin involvement (see
// PlatformService.createTenantUser for the admin-bootstrap equivalent this
// mirrors). No email verification - consistent with the rest of this app,
// which has never sent or verified email (see MailerService's removal).
@Injectable()
export class SignupService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
    private readonly jwt: JwtService,
  ) {}

  async register(dto: SignupDto) {
    // Checked here too, before creating the Tenant row - UsersService.create
    // enforces this same constraint, but only after the tenant would already
    // exist, which'd leave an orphaned zero-user Tenant behind on a retry
    // with an already-registered email (a common case: mistyped email, or
    // someone re-submitting the form). Still a small last-write-wins race
    // under true concurrency, acceptable for a low-volume signup endpoint.
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) {
      throw new ConflictException('email already in use');
    }

    const tenant = await this.prisma.tenant.create({
      data: { name: dto.companyName, trialEndsAt: trialEndsAtFromNow() },
    });

    // UsersService.create already hashes the password and enforces the
    // system-wide-unique email constraint (ConflictException on collision) -
    // reused rather than duplicated, same as PlatformService does.
    // No real "actor" exists yet (this IS the tenant's first user, created by
    // an unauthenticated signup request) - passed full access so the
    // privilege-escalation check UsersService.create now runs never blocks
    // this bootstrap case, which always grants full access anyway (see
    // defaultPermissionsFor).
    const user = await this.usersService.create(tenant.id, [...TENANT_ONLY_PERMISSION_KEYS], {
      email: dto.email,
      password: dto.password,
      name: dto.name,
      customerId: null,
    });

    // Same shape as AuthService.login's response, so the frontend's signup
    // action can set the session cookie identically to the login action -
    // auto-login right after signup, no separate login step.
    const token = await this.jwt.signAsync({ sub: user.id, tenantId: tenant.id, customerId: null });
    return { token, user: { ...user, tenantId: tenant.id } };
  }
}
