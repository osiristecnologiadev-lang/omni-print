import { Body, Controller, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { PlatformAuthService } from './platform-auth.service';
import { PlatformLoginDto } from './dto/login.dto';

@Controller('v1/platform/auth')
export class PlatformAuthController {
  constructor(private readonly platformAuthService: PlatformAuthService) {}

  // Same tighter throttle as the tenant login - password-guessing surface,
  // and this one guards access to every tenant at once.
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('login')
  login(@Body() dto: PlatformLoginDto) {
    return this.platformAuthService.login(dto.email, dto.password);
  }
}
