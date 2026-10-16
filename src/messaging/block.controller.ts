import { Body, Controller, Delete, Headers, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentPrincipal } from '../auth/auth.decorators.js';
import type { AuthPrincipal } from '../auth/auth.types.js';
import { ConversationParams } from './conversation.dto.js';
import { BlockConversationDto } from './block.dto.js';
import { MessagingBlockService } from './block.service.js';

@Controller('organizations/:organizationId/conversations/:conversationId/block')
@UseGuards(AuthGuard)
export class MessagingBlockController {
  constructor(private readonly blocks: MessagingBlockService) {}

  @Post()
  @HttpCode(204)
  async block(@CurrentPrincipal() principal: AuthPrincipal, @Param() params: ConversationParams, @Headers('idempotency-key') key: string | undefined, @Body() input: BlockConversationDto): Promise<void> { await this.blocks.block(principal, params.organizationId, params.conversationId, input, key); }

  @Delete()
  @HttpCode(204)
  async unblock(@CurrentPrincipal() principal: AuthPrincipal, @Param() params: ConversationParams, @Headers('idempotency-key') key: string | undefined): Promise<void> { await this.blocks.unblock(principal, params.organizationId, params.conversationId, key); }
}
