import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthPrincipal } from '../auth/auth.types.js';
import { EffectiveEntitlementsService } from '../entitlements/effective-entitlements.service.js';

type MessagingTransaction = Prisma.TransactionClient;

@Injectable()
export class MessagingPolicy {
  constructor(private readonly entitlements: EffectiveEntitlementsService) {}

  async assertCanInitiate(tx: MessagingTransaction, _principal: AuthPrincipal, sourceOrganizationId: string, targetOrganizationId: string): Promise<void> {
    if (sourceOrganizationId === targetOrganizationId) throw new ConflictException('An organization cannot message itself');

    const organizations = await tx.organization.findMany({
      where: { id: { in: [sourceOrganizationId, targetOrganizationId] } },
      select: { id: true, status: true, networkProfile: { select: { isPublic: true } } },
    });
    const source = organizations.find((organization) => organization.id === sourceOrganizationId);
    const target = organizations.find((organization) => organization.id === targetOrganizationId);
    if (!source || !target || source.status !== 'ACTIVE' || target.status !== 'ACTIVE') throw new ForbiddenException('Messaging organizations are not active');
    if (!target.networkProfile?.isPublic) throw new ForbiddenException('Target organization is not available for messaging');

    const [connection, trust, sourceEntitlements, targetEntitlements, block] = await Promise.all([
      tx.connectionRequest.findFirst({
        where: {
          status: 'ACCEPTED',
          OR: [
            { sourceOrganizationId, targetOrganizationId },
            { sourceOrganizationId: targetOrganizationId, targetOrganizationId: sourceOrganizationId },
          ],
        },
        select: { id: true },
      }),
      tx.organizationNetworkTrust.findUnique({ where: { organizationId: sourceOrganizationId }, select: { verificationStatus: true, verificationExpiresAt: true } }),
      this.entitlements.resolve(sourceOrganizationId),
      this.entitlements.resolve(targetOrganizationId),
      tx.messagingOrganizationBlock.findFirst({
        where: {
          active: true,
          OR: [
            { sourceOrganizationId, targetOrganizationId },
            { sourceOrganizationId: targetOrganizationId, targetOrganizationId: sourceOrganizationId },
          ],
        },
        select: { id: true },
      }),
    ]);

    if (!connection) throw new ForbiddenException('An accepted Network connection is required');
    if (!trust || trust.verificationStatus !== 'VERIFIED' || (trust.verificationExpiresAt && trust.verificationExpiresAt <= new Date())) {
      throw new ForbiddenException('Source organization Network verification is required');
    }
    if (!this.messagingAllowed(sourceEntitlements) || !this.messagingAllowed(targetEntitlements)) {
      throw new ForbiddenException('Messaging entitlement is required for both organizations');
    }
    if (block) throw new ForbiddenException('Messaging is blocked for this organization pair');
  }

  async assertCanSend(tx: MessagingTransaction, principal: AuthPrincipal, conversationId: string): Promise<{ sourceOrganizationId: string; targetOrganizationId: string }> {
    const conversation = await tx.conversation.findUnique({
      where: { id: conversationId },
      select: {
        id: true,
        status: true,
        organizationLowId: true,
        organizationHighId: true,
        organizationParticipants: { select: { organizationId: true, status: true } },
        userParticipants: { where: { userId: principal.userId, status: 'ACTIVE' }, select: { organizationId: true } },
      },
    });
    if (!conversation) throw new NotFoundException('Conversation not found');
    if (conversation.status !== 'OPEN') throw new ForbiddenException('Conversation is suspended');
    const actorParticipant = conversation.userParticipants[0];
    if (!actorParticipant) throw new NotFoundException('Conversation not found');
    const targetOrganizationId = actorParticipant.organizationId === conversation.organizationLowId ? conversation.organizationHighId : conversation.organizationLowId;
    const organizationsAreActive = conversation.organizationParticipants.length === 2 && conversation.organizationParticipants.every((participant) => participant.status === 'ACTIVE');
    if (!organizationsAreActive) throw new ForbiddenException('Conversation organizations are not active participants');
    await this.assertCanInitiate(tx, principal, actorParticipant.organizationId, targetOrganizationId);
    const targetHasActiveUser = await tx.conversationUserParticipant.findFirst({ where: { conversationId, organizationId: targetOrganizationId, status: 'ACTIVE' }, select: { id: true } });
    if (!targetHasActiveUser) throw new ForbiddenException('A recipient participant is required');
    return { sourceOrganizationId: actorParticipant.organizationId, targetOrganizationId };
  }

  private messagingAllowed(projection: { modules: Array<{ code: string; allowed: boolean }> }): boolean {
    return projection.modules.some((module) => module.code === 'MESSAGING' && module.allowed);
  }
}
