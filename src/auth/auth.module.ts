import { Module } from '@nestjs/common';
import { EventModule } from '../events/event.module.js';
import { AuthController } from './auth.controller.js';
import { AuthGuard } from './auth.guard.js';
import { AuthService } from './auth.service.js';
import { PasswordService } from './password.service.js';
import { TokenService } from './token.service.js';
import { LoginRateLimiter } from './login-rate-limiter.service.js';

@Module({
  imports: [EventModule],
  controllers: [AuthController],
  providers: [AuthService, AuthGuard, PasswordService, TokenService, LoginRateLimiter],
  exports: [AuthGuard, AuthService, TokenService],
})
export class AuthModule {}
