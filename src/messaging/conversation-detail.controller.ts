import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentPrincipal } from '../auth/auth.decorators.js';
import type { AuthPrincipal } from '../auth/auth.types.js';
import { ConversationService } from './conversation.service.js';
import { ConversationParams } from './conversation.dto.js';

@Controller('organizations/:organizationId/conversations/:conversationId')
@UseGuards(AuthGuard)
export class ConversationDetailController {
  constructor(private readonly conversations: ConversationService) {}

  @Get()
  get(@CurrentPrincipal() principal: AuthPrincipal, @Param() params: ConversationParams): Promise<unknown> { return this.conversations.get(principal, params.organizationId, params.conversationId); }
}
