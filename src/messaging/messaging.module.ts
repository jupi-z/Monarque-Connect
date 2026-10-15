import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { EventModule } from '../events/event.module.js';
import { TenancyModule } from '../tenancy/tenancy.module.js';
import { EntitlementsModule } from '../entitlements/entitlements.module.js';
import { ConversationController } from './conversation.controller.js';
import { ConversationDetailController } from './conversation-detail.controller.js';
import { InvitationController } from './invitation.controller.js';
import { ConversationService } from './conversation.service.js';
import { MessagingInvitationService } from './invitation.service.js';
import { MessagingAuthorization } from './messaging.authorization.js';
import { MessagingPolicy } from '../network/messaging-policy.service.js';

@Module({
  imports: [AuthModule, EventModule, TenancyModule, EntitlementsModule],
  controllers: [ConversationController, ConversationDetailController, InvitationController],
  providers: [MessagingAuthorization, MessagingPolicy, ConversationService, MessagingInvitationService],
})
export class MessagingModule {}
