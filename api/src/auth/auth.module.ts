import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { UserAuthGuard } from './user-auth.guard';

// Global: UserAuthGuard and JwtService are needed by several feature
// modules (devices, customers, ...) - registering once here avoids
// re-importing JwtModule with the same config in each of them. This same
// config also backs PlatformAuthService (see platform/platform-auth.service.ts) -
// it has no JwtModule import of its own, it relies on this global one.
//
// expiresIn: session lifetime before a re-login is required (matches the
// cookie's own maxAge - see web's login actions.ts for both tenant and
// platform). 8h was chosen deliberately over a long-lived session (this
// app carries billing/customer data) but still covers a full workday
// without forcing a mid-day re-login.
@Global()
@Module({
  imports: [
    JwtModule.register({
      global: true,
      secret: process.env.JWT_SECRET,
      signOptions: { expiresIn: '8h' },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, UserAuthGuard],
  exports: [UserAuthGuard],
})
export class AuthModule {}
