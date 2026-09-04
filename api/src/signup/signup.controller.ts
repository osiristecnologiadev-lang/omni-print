import { Body, Controller, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { SignupDto } from './dto/signup.dto';
import { SignupService } from './signup.service';

@Controller('v1')
export class SignupController {
  constructor(private readonly signupService: SignupService) {}

  // Same limit as /v1/auth/login (auth.controller.ts) - the same class of
  // abuse surface (mass tenant creation instead of credential guessing).
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('signup')
  signup(@Body() dto: SignupDto) {
    return this.signupService.register(dto);
  }
}
