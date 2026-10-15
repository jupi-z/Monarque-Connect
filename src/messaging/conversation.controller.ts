import { Body, Controller, Get, Headers, Param, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentPrincipal } from '../auth/auth.decorators.js';
import type { AuthPrincipal } from '../auth/auth.types.js';
import { ConversationService } from './conversation.service.js';
import { ConversationListQuery, ConversationOrganizationParams, CreateConversationDto } from './conversation.dto.js';

@Controller('organizations/:organizationId/conversations')
@UseGuards(AuthGuard)
export class ConversationController {
  constructor(private readonly conversations: ConversationService) {}

  @Get()
  list(@CurrentPrincipal() principal: AuthPrincipal, @Param() params: ConversationOrganizationParams, @Query() query: ConversationListQuery): Promise<unknown> { return this.conversations.list(principal, params.organizationId, query); }

  @Post()
  create(@CurrentPrincipal() principal: AuthPrincipal, @Param() params: ConversationOrganizationParams, @Headers('idempotency-key') key: string | undefined, @Body() input: CreateConversationDto): Promise<unknown> { return this.conversations.create(principal, params.organizationId, input, key); }
}
