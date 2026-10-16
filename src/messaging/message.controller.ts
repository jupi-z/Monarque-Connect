import { Body, Controller, Get, Headers, Param, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentPrincipal } from '../auth/auth.decorators.js';
import type { AuthPrincipal } from '../auth/auth.types.js';
import { MessageService } from './message.service.js';
import { MessageListQuery, MessageParams, SendMessageDto } from './message.dto.js';

@Controller('organizations/:organizationId/conversations/:conversationId/messages')
@UseGuards(AuthGuard)
export class MessageController {
  constructor(private readonly messages: MessageService) {}

  @Get()
  list(@CurrentPrincipal() principal: AuthPrincipal, @Param() params: MessageParams, @Query() query: MessageListQuery): Promise<unknown> { return this.messages.list(principal, params.organizationId, params.conversationId, query); }

  @Post()
  send(@CurrentPrincipal() principal: AuthPrincipal, @Param() params: MessageParams, @Headers('idempotency-key') key: string | undefined, @Body() input: SendMessageDto): Promise<unknown> { return this.messages.send(principal, params.organizationId, params.conversationId, input, key); }
}
