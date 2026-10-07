import { Body, Controller, Post, Get, HttpCode, HttpStatus, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from './auth.guard.js';
import { CurrentPrincipal } from './auth.decorators.js';
import type { AuthPrincipal } from './auth.types.js';
import { AuthService } from './auth.service.js';
import { ChangePasswordDto, LoginDto, RefreshDto, RegisterDto } from './auth.dto.js';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  async register(@Body() input: RegisterDto): Promise<unknown> { return this.auth.register(input); }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() input: LoginDto, @Req() request: Request): Promise<unknown> { return this.auth.login(input, request.ip ?? request.socket.remoteAddress ?? 'unknown'); }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Body() input: RefreshDto): Promise<unknown> { return this.auth.refresh(input); }

  @UseGuards(AuthGuard)
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@CurrentPrincipal() principal: AuthPrincipal): Promise<void> { await this.auth.logout(principal); }

  @UseGuards(AuthGuard)
  @Post('password/change')
  @HttpCode(HttpStatus.NO_CONTENT)
  async changePassword(@CurrentPrincipal() principal: AuthPrincipal, @Body() input: ChangePasswordDto): Promise<void> { await this.auth.changePassword(principal, input); }

  @UseGuards(AuthGuard)
  @Get('me')
  async me(@CurrentPrincipal() principal: AuthPrincipal): Promise<unknown> { return this.auth.me(principal); }
}
