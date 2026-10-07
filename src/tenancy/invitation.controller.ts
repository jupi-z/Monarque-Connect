import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentPrincipal } from '../auth/auth.decorators.js';
import type { AuthPrincipal } from '../auth/auth.types.js';
import { CreateInvitationDto } from './invitation.dto.js';
import { InvitationService } from './invitation.service.js';

@Controller()
@UseGuards(AuthGuard)
export class InvitationController {
  constructor(private readonly invitations: InvitationService) {}

  @Post('organizations/:organizationId/invitations')
  async create(@CurrentPrincipal() principal: AuthPrincipal, @Param('organizationId') organizationId: string, @Body() input: CreateInvitationDto): Promise<unknown> { return this.invitations.create(principal, organizationId, input); }

  @Post('invitations/:token/accept')
  async accept(@CurrentPrincipal() principal: AuthPrincipal, @Param('token') token: string): Promise<unknown> { return this.invitations.accept(principal, token); }
}
