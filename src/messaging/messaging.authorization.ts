import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
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

export interface MessagingOrganizationParticipantManagement {
  context: AuthorizationContext;
  organizationParticipant: {
    organizationId: string;
    establishmentId: string | null;
    status: string;
    joinedAt: Date | null;
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
    if (context.scopeMode === 'SELECTED_ESTABLISHMENTS' && organizationParticipant.establishmentId) await this.authorization.assertEstablishment(context, organizationParticipant.establishmentId);
    return { context, participant, organizationParticipant };
  }

  async requireOrganizationParticipantManagement(principal: AuthPrincipal, organizationId: string, conversationId: string): Promise<MessagingOrganizationParticipantManagement> {
    const context = await this.authorization.requireModule(principal, organizationId, 'MESSAGING', 'messaging:participants:write');
    if (context.role !== 'OWNER' && context.role !== 'ADMIN') throw new ForbiddenException('Only an organization owner or admin can manage conversation participants');
    const organizationParticipant = await this.prisma.conversationOrganizationParticipant.findUnique({
      where: { conversationId_organizationId: { conversationId, organizationId } },
      select: { organizationId: true, establishmentId: true, status: true, joinedAt: true },
    });
    if (!organizationParticipant || organizationParticipant.status !== 'ACTIVE' || !organizationParticipant.joinedAt) throw new NotFoundException('Conversation not found');
    if (context.scopeMode === 'SELECTED_ESTABLISHMENTS' && organizationParticipant.establishmentId) await this.authorization.assertEstablishment(context, organizationParticipant.establishmentId);
    return { context, organizationParticipant };
  }

  async revalidateParticipantAccess(tx: Prisma.TransactionClient, principal: AuthPrincipal, organizationId: string, conversationId: string, permission: MessagingPermission): Promise<void> {
    const context = await this.authorization.requireModuleInTransaction(tx, principal, organizationId, 'MESSAGING', permission);
    const lockedUserParticipant = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT id FROM "conversation_user_participants" WHERE conversation_id = ${conversationId}::uuid AND organization_id = ${organizationId}::uuid AND user_id = ${principal.userId}::uuid FOR UPDATE`);
    const userParticipantId = lockedUserParticipant[0]?.id;
    if (!userParticipantId) throw new NotFoundException('Conversation not found');
    const participant = await tx.conversationUserParticipant.findUnique({ where: { id: userParticipantId }, select: { status: true } });
    if (!participant || participant.status !== 'ACTIVE') throw new NotFoundException('Conversation not found');
    const lockedOrganizationParticipant = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT id FROM "conversation_organization_participants" WHERE conversation_id = ${conversationId}::uuid AND organization_id = ${organizationId}::uuid FOR UPDATE`);
    const organizationParticipantId = lockedOrganizationParticipant[0]?.id;
    if (!organizationParticipantId) throw new NotFoundException('Conversation not found');
    const organizationParticipant = await tx.conversationOrganizationParticipant.findUnique({ where: { id: organizationParticipantId }, select: { establishmentId: true, status: true } });
    if (!organizationParticipant || organizationParticipant.status !== 'ACTIVE') throw new NotFoundException('Conversation not found');
    if (context.scopeMode === 'SELECTED_ESTABLISHMENTS' && organizationParticipant.establishmentId) {
      const establishment = await tx.establishment.findFirst({ where: { id: organizationParticipant.establishmentId, organizationId, status: 'ACTIVE' }, select: { id: true } });
      if (!establishment || !context.establishmentIds.includes(organizationParticipant.establishmentId)) throw new ForbiddenException('Establishment access denied');
    }
  }

  async revalidateOrganizationParticipantManagement(tx: Prisma.TransactionClient, principal: AuthPrincipal, organizationId: string, conversationId: string): Promise<MessagingOrganizationParticipantManagement> {
    const membershipCandidate = await tx.membership.findUnique({ where: { organizationId_userId: { organizationId, userId: principal.userId } }, select: { id: true } });
    if (!membershipCandidate) throw new ForbiddenException('Organization access denied');
    const lockedMembership = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT id FROM "memberships" WHERE id = ${membershipCandidate.id}::uuid FOR UPDATE`);
    if (lockedMembership.length === 0) throw new ForbiddenException('Organization access denied');
    const membership = await tx.membership.findUnique({
      where: { id: membershipCandidate.id },
      include: { user: { select: { status: true } }, organization: { select: { status: true } }, scopeLinks: { select: { establishmentId: true } } },
    });
    if (!membership || membership.status !== 'ACTIVE' || membership.user.status !== 'ACTIVE' || membership.organization.status !== 'ACTIVE') throw new ForbiddenException('Organization access denied');
    if (membership.role !== 'OWNER' && membership.role !== 'ADMIN') throw new ForbiddenException('Only an organization owner or admin can manage conversation participants');
    const context: AuthorizationContext = {
      userId: principal.userId,
      sessionId: principal.sessionId,
      organizationId,
      membershipId: membership.id,
      role: membership.role,
      scopeMode: membership.scopeMode,
      establishmentIds: membership.scopeLinks.map((scope) => scope.establishmentId),
    };
    const lockedParticipant = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT id FROM "conversation_organization_participants" WHERE conversation_id = ${conversationId}::uuid AND organization_id = ${organizationId}::uuid FOR UPDATE`);
    const lockedParticipantId = lockedParticipant[0]?.id;
    if (!lockedParticipantId) throw new NotFoundException('Conversation not found');
    const organizationParticipant = await tx.conversationOrganizationParticipant.findUnique({ where: { id: lockedParticipantId }, select: { organizationId: true, establishmentId: true, status: true, joinedAt: true } });
    if (!organizationParticipant || organizationParticipant.status !== 'ACTIVE' || !organizationParticipant.joinedAt) throw new NotFoundException('Conversation not found');
    if (context.scopeMode === 'SELECTED_ESTABLISHMENTS' && organizationParticipant.establishmentId) {
      const establishment = await tx.establishment.findFirst({ where: { id: organizationParticipant.establishmentId, organizationId, status: 'ACTIVE' }, select: { id: true } });
      if (!establishment || !context.establishmentIds.includes(organizationParticipant.establishmentId)) throw new ForbiddenException('Establishment access denied');
    }
    return { context, organizationParticipant };
  }
}
