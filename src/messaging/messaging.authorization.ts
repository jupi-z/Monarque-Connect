import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { AuthPrincipal, AuthorizationContext } from '../auth/auth.types.js';
import { PrismaService } from '../database/prisma.service.js';
import { AuthorizationService, type Permission } from '../tenancy/authorization.service.js';

export type MessagingPermission = Extract<Permission, `messaging:${string}`>;

export interface MessagingParticipantAccess {
  context: AuthorizationContext;
  participant: {
    id: string;
    organizationId: string;
    userId: string;
    status: string;
    historyVisibleFromSequence: bigint;
  };
  organizationParticipant: {
    organizationId: string;
    establishmentId: string | null;
    status: string;
  };
}

@Injectable()
export class MessagingAuthorization {
  constructor(private readonly prisma: PrismaService, private readonly authorization: AuthorizationService) {}

  async requireParticipantAccess(principal: AuthPrincipal, organizationId: string, conversationId: string, permission: MessagingPermission): Promise<MessagingParticipantAccess> {
    const context = await this.authorization.requireModule(principal, organizationId, 'MESSAGING', permission);
    const participant = await this.prisma.conversationUserParticipant.findFirst({
      where: { conversationId, organizationId, userId: principal.userId, status: 'ACTIVE' },
      select: { id: true, organizationId: true, userId: true, status: true, historyVisibleFromSequence: true },
    });
    if (!participant) throw new NotFoundException('Conversation not found');
    const organizationParticipant = await this.prisma.conversationOrganizationParticipant.findUnique({
      where: { conversationId_organizationId: { conversationId, organizationId } },
      select: { organizationId: true, establishmentId: true, status: true },
    });
    if (!organizationParticipant || organizationParticipant.status !== 'ACTIVE') throw new NotFoundException('Conversation not found');
    if (context.scopeMode === 'SELECTED_ESTABLISHMENTS') {
      if (!organizationParticipant.establishmentId) throw new ForbiddenException('Conversation establishment scope is not defined');
      await this.authorization.assertEstablishment(context, organizationParticipant.establishmentId);
    }
    return { context, participant, organizationParticipant };
  }
}
