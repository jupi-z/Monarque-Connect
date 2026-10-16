import { Body, Controller, Delete, Get, Headers, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentPrincipal } from '../auth/auth.decorators.js';
import type { AuthPrincipal } from '../auth/auth.types.js';
import { ConversationListQuery, ConversationParams, InvitationParams, ParticipantParams, ConversationOrganizationParams, CreateParticipantInvitationDto, AcceptConversationInvitationDto, InvitationDecisionDto } from './conversation.dto.js';
import { MessagingInvitationService } from './invitation.service.js';

@Controller('organizations/:organizationId')
@UseGuards(AuthGuard)
export class InvitationController {
  constructor(private readonly invitations: MessagingInvitationService) {}

  @Get('conversation-invitations')
  list(@CurrentPrincipal() principal: AuthPrincipal, @Param() params: ConversationOrganizationParams, @Query() query: ConversationListQuery): Promise<unknown> { return this.invitations.list(principal, params.organizationId, query); }

  @Post('conversation-invitations/:invitationId/token')
  @HttpCode(200)
  issueToken(@CurrentPrincipal() principal: AuthPrincipal, @Param() params: InvitationParams, @Headers('idempotency-key') key: string | undefined): Promise<unknown> { return this.invitations.issueToken(principal, params.organizationId, params.invitationId, key); }

  @Post('conversation-invitations/:invitationId/accept')
  @HttpCode(200)
  accept(@CurrentPrincipal() principal: AuthPrincipal, @Param() params: InvitationParams, @Headers('idempotency-key') key: string | undefined, @Body() input: AcceptConversationInvitationDto): Promise<unknown> { return this.invitations.accept(principal, params.organizationId, params.invitationId, input, key); }

  @Post('conversation-invitations/:invitationId/decline')
  @HttpCode(204)
  decline(@CurrentPrincipal() principal: AuthPrincipal, @Param() params: InvitationParams, @Headers('idempotency-key') key: string | undefined, @Body() input: InvitationDecisionDto): Promise<void> { return this.invitations.decline(principal, params.organizationId, params.invitationId, input, key); }

  @Post('conversations/:conversationId/participant-invitations')
  createParticipantInvitation(@CurrentPrincipal() principal: AuthPrincipal, @Param() params: ConversationParams, @Headers('idempotency-key') key: string | undefined, @Body() input: CreateParticipantInvitationDto): Promise<unknown> { return this.invitations.createParticipantInvitation(principal, params.organizationId, params.conversationId, input, key); }

  @Delete('conversations/:conversationId/participants/:userId')
  @HttpCode(204)
  leaveOrRevokeParticipant(@CurrentPrincipal() principal: AuthPrincipal, @Param() params: ParticipantParams, @Headers('idempotency-key') key: string | undefined): Promise<void> { return this.invitations.leaveOrRevokeParticipant(principal, params.organizationId, params.conversationId, params.userId, key); }
}
