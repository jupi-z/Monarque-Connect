import { createHash, randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, ForbiddenException, GoneException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type AuditAction } from '@prisma/client';
import { PrismaService } from '../database/prisma.service.js';
import { PrismaOutboxWriter } from '../events/prisma-outbox.writer.js';
import { createDomainEvent } from '../events/domain-event.factory.js';
import { createRequestContext, currentEventContext } from '../events/event-context.js';
import type { AuthPrincipal, AuthorizationContext } from '../auth/auth.types.js';
import { AuthorizationService } from '../tenancy/authorization.service.js';
import { MessagingAuthorization } from './messaging.authorization.js';
import { MessagingPolicy } from '../network/messaging-policy.service.js';
import type { ConversationListQuery, CreateParticipantInvitationDto, AcceptConversationInvitationDto, InvitationDecisionDto } from './conversation.dto.js';
import { decryptInvitationToken, encryptInvitationToken, tokenDigest, tokenExpiry } from './invitation-token.js';

type Context = { requestId: string; correlationId: string };
type Cursor = { createdAt: string; id: string };
const invitationSelect = { id: true, type: true, conversationId: true, organizationId: true, targetOrganizationId: true, targetUserId: true, status: true, expiresAt: true, createdAt: true } as const;

@Injectable()
export class MessagingInvitationService {
  constructor(private readonly prisma: PrismaService, private readonly authorization: AuthorizationService, private readonly messagingAuthorization: MessagingAuthorization, private readonly policy: MessagingPolicy, private readonly outbox: PrismaOutboxWriter) {}

  async list(principal: AuthPrincipal, organizationId: string, query: ConversationListQuery): Promise<unknown> {
    const context = await this.authorization.requireModule(principal, organizationId, 'MESSAGING', 'messaging:read');
    const now = new Date();
    const cursor = query.cursor ? this.decodeCursor(query.cursor) : undefined;
    const where = context.role === 'OWNER' || context.role === 'ADMIN'
      ? { targetOrganizationId: organizationId, status: 'PENDING' as const, expiresAt: { gt: now }, ...(cursor ? { OR: [{ createdAt: { gt: new Date(cursor.createdAt) } }, { createdAt: new Date(cursor.createdAt), id: { gt: cursor.id } }] } : {}) }
      : { targetOrganizationId: organizationId, targetUserId: principal.userId, type: 'USER' as const, status: 'PENDING' as const, expiresAt: { gt: now }, ...(cursor ? { OR: [{ createdAt: { gt: new Date(cursor.createdAt) } }, { createdAt: new Date(cursor.createdAt), id: { gt: cursor.id } }] } : {}) };
    const limit = query.limit ?? 20;
    const rows = await this.prisma.messagingInvitation.findMany({ where, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: limit + 1, select: invitationSelect });
    const next = rows.length > limit ? rows[limit - 1] : undefined;
    return { items: rows.slice(0, limit).map((row) => this.serialize(row)), nextCursor: next ? this.encodeCursor({ createdAt: next.createdAt.toISOString(), id: next.id }) : null };
  }

  async issueToken(principal: AuthPrincipal, organizationId: string, invitationId: string, rawKey?: string): Promise<unknown> {
    const key = this.requireKey(rawKey);
    const context = await this.authorization.requireModule(principal, organizationId, 'MESSAGING', 'messaging:read');
    const payloadHash = this.hash({ operation: 'INVITATION_TOKEN_ISSUE', organizationId, invitationId });
    const eventContext = this.eventContext();
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`SELECT id FROM "messaging_invitations" WHERE id = ${invitationId}::uuid AND target_organization_id = ${organizationId}::uuid FOR UPDATE`);
      const invitation = await tx.messagingInvitation.findFirst({ where: { id: invitationId, targetOrganizationId: organizationId }, select: { ...invitationSelect, tokenDigest: true, tokenCiphertext: true, tokenExpiresAt: true } });
      this.assertInvitationActor(context, invitation?.type, invitation?.targetUserId, principal.userId);
      if (!invitation) throw new NotFoundException('Invitation not found');

      const receipt = await tx.messagingCommandReceipt.findUnique({ where: { organizationId_actorUserId_operation_idempotencyKey: { organizationId, actorUserId: principal.userId, operation: 'INVITATION_TOKEN_ISSUE', idempotencyKey: key } }, select: { payloadHash: true, responseJson: true } });
      if (receipt) {
        if (receipt.payloadHash !== payloadHash) throw new ConflictException('Idempotency-Key was already used with a different command');
        const stored = receipt.responseJson as { invitationId?: unknown; tokenCiphertext?: unknown; token?: unknown; expiresAt?: unknown };
        const ciphertext = typeof stored.tokenCiphertext === 'string' ? stored.tokenCiphertext : undefined;
        const token = ciphertext ? decryptInvitationToken(ciphertext) : typeof stored.token === 'string' ? stored.token : undefined;
        if (!token || typeof stored.expiresAt !== 'string') throw new ConflictException('Invitation token receipt is invalid');
        return { invitationId: invitation.id, token, expiresAt: stored.expiresAt };
      }

      if (invitation.status !== 'PENDING') throw new ConflictException('Invitation is no longer valid');
      if (invitation.expiresAt <= new Date()) throw new GoneException('Invitation has expired');
      const now = new Date();
      const renew = invitation.tokenExpiresAt <= now;
      const token = renew ? randomUUID().replaceAll('-', '') + randomUUID().replaceAll('-', '') : decryptInvitationToken(invitation.tokenCiphertext);
      const expiresAt = renew ? tokenExpiry(now) : invitation.tokenExpiresAt;
      const tokenCiphertext = renew ? encryptInvitationToken(token) : invitation.tokenCiphertext;
      if (renew) await tx.messagingInvitation.update({ where: { id: invitation.id }, data: { tokenDigest: tokenDigest(token), tokenCiphertext, tokenIssuedAt: now, tokenExpiresAt: expiresAt } });
      await this.recordMutation(tx, 'MESSAGING_INVITATION_TOKEN_ISSUED', 'messaging.invitation.token_issued.v1', principal, organizationId, invitation.id, eventContext, { invitationType: invitation.type });
      await tx.messagingInvitation.update({ where: { id: invitation.id }, data: { tokenDeliveredAt: now } });
      const response = { invitationId: invitation.id, token, expiresAt: expiresAt.toISOString() };
      await tx.messagingCommandReceipt.create({ data: { id: randomUUID(), organizationId, actorUserId: principal.userId, operation: 'INVITATION_TOKEN_ISSUE', idempotencyKey: key, payloadHash, resourceType: 'MessagingInvitation', resourceId: invitation.id, responseJson: { invitationId: invitation.id, tokenCiphertext, expiresAt: response.expiresAt } } });
      return response;
    });
  }

  async accept(principal: AuthPrincipal, organizationId: string, invitationId: string, input: AcceptConversationInvitationDto, rawKey?: string): Promise<unknown> {
    return this.decide(principal, organizationId, invitationId, input.token, 'ACCEPT', rawKey);
  }

  async decline(principal: AuthPrincipal, organizationId: string, invitationId: string, input: InvitationDecisionDto, rawKey?: string): Promise<void> {
    await this.decide(principal, organizationId, invitationId, input.token, 'DECLINE', rawKey);
  }

  async createParticipantInvitation(principal: AuthPrincipal, organizationId: string, conversationId: string, input: CreateParticipantInvitationDto, rawKey?: string): Promise<unknown> {
    await this.authorization.requireModule(principal, organizationId, 'MESSAGING', 'messaging:participants:write');
    const key = this.requireKey(rawKey);
    const payloadHash = this.hash({ operation: 'PARTICIPANT_INVITE', organizationId, conversationId, input });
    await this.messagingAuthorization.requireOrganizationParticipantManagement(principal, organizationId, conversationId);
    const eventContext = this.eventContext();
    return this.prisma.$transaction(async (tx) => {
      await this.messagingAuthorization.revalidateOrganizationParticipantManagement(tx, principal, organizationId, conversationId);
      const replay = await this.findReceipt(tx, organizationId, principal.userId, 'PARTICIPANT_INVITE', key, payloadHash);
      if (replay) return replay.response;
      const conversation = await tx.conversation.findFirst({ where: { id: conversationId, status: 'OPEN', OR: [{ organizationLowId: organizationId }, { organizationHighId: organizationId }] }, select: { id: true, lastMessageSequence: true } });
      if (!conversation) throw new NotFoundException('Conversation not found');
      const organizationInvitation = await tx.messagingInvitation.findFirst({ where: { conversationId, type: 'ORGANIZATION', targetOrganizationId: organizationId, status: 'ACCEPTED' }, select: { id: true, organizationId: true } });
      if (!organizationInvitation) throw new ForbiddenException('The counterpart organization has not accepted the conversation');
      await this.policy.assertCanReceive(tx, organizationInvitation.organizationId, organizationId);
      const targetMembership = await tx.membership.findFirst({ where: { organizationId, userId: input.userId, status: 'ACTIVE', user: { status: 'ACTIVE' } }, select: { id: true } });
      if (!targetMembership) throw new NotFoundException('Target user is not an active member of this organization');
      const existing = await tx.conversationUserParticipant.findUnique({ where: { conversationId_organizationId_userId: { conversationId, organizationId, userId: input.userId } }, select: { status: true } });
      if (existing?.status === 'ACTIVE') throw new ConflictException('User is already a conversation participant');
      const now = new Date();
      const token = randomUUID().replaceAll('-', '') + randomUUID().replaceAll('-', '');
      const expiresAt = input.expiresAt ? new Date(input.expiresAt) : new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
      if (Number.isNaN(expiresAt.getTime()) || expiresAt <= now) throw new BadRequestException('Invitation expiry is invalid');
      const invitation = await tx.messagingInvitation.create({ data: { id: randomUUID(), type: 'USER', conversationId, organizationId, targetOrganizationId: organizationId, targetUserId: input.userId, tokenDigest: tokenDigest(token), tokenCiphertext: encryptInvitationToken(token), tokenIssuedAt: now, tokenExpiresAt: new Date(Math.min(tokenExpiry(now).getTime(), expiresAt.getTime())), expiresAt, createdByUserId: principal.userId }, select: invitationSelect });
      const response = this.serialize(invitation);
      await this.recordMutation(tx, 'MESSAGING_PARTICIPANT_INVITED', 'messaging.user_invitation.created.v1', principal, organizationId, invitation.id, eventContext, { conversationId, targetUserId: input.userId });
      await tx.messagingCommandReceipt.create({ data: { id: randomUUID(), organizationId, actorUserId: principal.userId, operation: 'PARTICIPANT_INVITE', idempotencyKey: key, payloadHash, resourceType: 'MessagingInvitation', resourceId: invitation.id, responseJson: response as Prisma.InputJsonValue } });
      return response;
    });
  }

  async leaveOrRevokeParticipant(principal: AuthPrincipal, organizationId: string, conversationId: string, userId: string, rawKey?: string): Promise<void> {
    const self = userId === principal.userId;
    if (self) await this.messagingAuthorization.requireParticipantAccess(principal, organizationId, conversationId, 'messaging:read');
    else {
      await this.messagingAuthorization.requireOrganizationParticipantManagement(principal, organizationId, conversationId);
    }
    const key = this.requireKey(rawKey);
    const operation = self ? 'PARTICIPANT_LEAVE' : 'PARTICIPANT_REVOKE';
    const payloadHash = this.hash({ operation, organizationId, conversationId, userId });
    const eventContext = this.eventContext();
    await this.prisma.$transaction(async (tx) => {
      if (!self) await this.messagingAuthorization.revalidateOrganizationParticipantManagement(tx, principal, organizationId, conversationId);
      const replay = await this.findReceipt(tx, organizationId, principal.userId, operation, key, payloadHash);
      if (replay) return;
      await tx.$executeRaw(Prisma.sql`SELECT id FROM "conversations" WHERE id = ${conversationId}::uuid FOR UPDATE`);
      const conversation = await tx.conversation.findFirst({ where: { id: conversationId, OR: [{ organizationLowId: organizationId }, { organizationHighId: organizationId }] }, select: { id: true } });
      if (!conversation) throw new NotFoundException('Conversation not found');
      const participant = await tx.conversationUserParticipant.findUnique({ where: { conversationId_organizationId_userId: { conversationId, organizationId, userId } }, select: { id: true, status: true } });
      if (!participant) throw new NotFoundException('Participant not found');
      if (participant.status === 'ACTIVE') {
        const action = self ? 'MESSAGING_PARTICIPANT_LEFT' : 'MESSAGING_PARTICIPANT_REVOKED';
        const nextStatus = self ? 'LEFT' : 'REVOKED';
        await tx.conversationUserParticipant.update({ where: { id: participant.id }, data: { status: nextStatus, leftAt: self ? new Date() : null, revokedAt: self ? null : new Date() } });
        await this.recordParticipantMutation(tx, action, self ? 'messaging.participant.left.v1' : 'messaging.participant.revoked.v1', principal, organizationId, participant.id, eventContext, { conversationId, userId, status: nextStatus });
        const pendingInvitations = await tx.messagingInvitation.findMany({ where: { conversationId, type: 'USER', targetOrganizationId: organizationId, targetUserId: userId, status: 'PENDING' }, select: { id: true } });
        for (const invitation of pendingInvitations) {
          await tx.messagingInvitation.update({ where: { id: invitation.id }, data: { status: 'REVOKED' } });
          await this.recordMutation(tx, 'MESSAGING_INVITATION_REVOKED', 'messaging.user_invitation.revoked.v1', principal, organizationId, invitation.id, eventContext, { conversationId, targetUserId: userId, reason: nextStatus });
        }
      }
      await tx.messagingCommandReceipt.create({ data: { id: randomUUID(), organizationId, actorUserId: principal.userId, operation, idempotencyKey: key, payloadHash, resourceType: 'ConversationUserParticipant', resourceId: participant.id, responseJson: { status: self ? 'LEFT' : 'REVOKED' } } });
    });
  }

  private async decide(principal: AuthPrincipal, organizationId: string, invitationId: string, token: string, decision: 'ACCEPT' | 'DECLINE', rawKey?: string): Promise<unknown> {
    const context = await this.authorization.requireModule(principal, organizationId, 'MESSAGING', 'messaging:read');
    const key = this.requireKey(rawKey);
    const payloadHash = this.hash({ operation: `INVITATION_${decision}`, organizationId, invitationId, tokenDigest: tokenDigest(token) });
    const eventContext = this.eventContext();
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`SELECT id FROM "messaging_invitations" WHERE id = ${invitationId}::uuid AND target_organization_id = ${organizationId}::uuid FOR UPDATE`);
      const replay = await this.findReceipt(tx, organizationId, principal.userId, `INVITATION_${decision}`, key, payloadHash);
      if (replay) return decision === 'DECLINE' ? undefined : replay.response;

      const invitation = await tx.messagingInvitation.findFirst({ where: { id: invitationId, targetOrganizationId: organizationId }, select: { ...invitationSelect, tokenDigest: true, tokenExpiresAt: true, conversationId: true } });
      this.assertInvitationActor(context, invitation?.type, invitation?.targetUserId, principal.userId);
      if (!invitation) throw new NotFoundException('Invitation not found');
      if (invitation.status !== 'PENDING') throw new ConflictException('Invitation is no longer valid');
      if (invitation.expiresAt <= new Date()) throw new GoneException('Invitation has expired');
      if (invitation.tokenDigest !== tokenDigest(token) || invitation.tokenExpiresAt <= new Date()) throw new ForbiddenException('Invitation token is invalid or expired');
      const conversation = await tx.conversation.findUniqueOrThrow({ where: { id: invitation.conversationId }, select: { organizationLowId: true, organizationHighId: true } });
      const sourceOrganizationId = invitation.type === 'ORGANIZATION'
        ? invitation.organizationId
        : invitation.organizationId === conversation.organizationLowId ? conversation.organizationHighId : conversation.organizationLowId;
      await this.policy.assertCanReceive(tx, sourceOrganizationId, invitation.targetOrganizationId);
      let response: unknown;
      if (decision === 'ACCEPT') {
        if (invitation.type === 'USER') {
          const organizationInvitation = await tx.messagingInvitation.findFirst({ where: { conversationId: invitation.conversationId, type: 'ORGANIZATION', targetOrganizationId: organizationId, status: 'ACCEPTED' }, select: { id: true } });
          if (!organizationInvitation) throw new ForbiddenException('Organization invitation must be accepted first');
          const conversationState = await tx.conversation.findUniqueOrThrow({ where: { id: invitation.conversationId }, select: { lastMessageSequence: true } });
          const joinedAt = new Date();
          const existing = await tx.conversationUserParticipant.findUnique({ where: { conversationId_organizationId_userId: { conversationId: invitation.conversationId, organizationId, userId: invitation.targetUserId! } }, select: { id: true, status: true } });
          const participantId = existing?.id ?? randomUUID();
          if (existing) await tx.conversationUserParticipant.update({ where: { id: existing.id }, data: { status: 'ACTIVE', joinedAt, leftAt: null, revokedAt: null, historyVisibleFromSequence: conversationState.lastMessageSequence + 1n } });
          else await tx.conversationUserParticipant.create({ data: { id: participantId, conversationId: invitation.conversationId, organizationId, userId: invitation.targetUserId!, status: 'ACTIVE', joinedAt, historyVisibleFromSequence: conversationState.lastMessageSequence + 1n } });
          await this.recordParticipantMutation(tx, 'MESSAGING_PARTICIPANT_JOINED', 'messaging.participant.joined.v1', principal, organizationId, participantId, eventContext, { conversationId: invitation.conversationId, userId: invitation.targetUserId });
        } else {
          const conversationState = await tx.conversation.findUniqueOrThrow({ where: { id: invitation.conversationId }, select: { lastMessageSequence: true } });
          const organizationParticipant = await tx.conversationOrganizationParticipant.findUnique({ where: { conversationId_organizationId: { conversationId: invitation.conversationId, organizationId } }, select: { id: true } });
          if (!organizationParticipant) throw new NotFoundException('Conversation organization participant not found');
          await tx.conversationOrganizationParticipant.update({ where: { id: organizationParticipant.id }, data: { status: 'ACTIVE', joinedAt: new Date(), leftAt: null, revokedAt: null, historyVisibleFromSequence: conversationState.lastMessageSequence + 1n } });
          await this.recordParticipantMutation(tx, 'MESSAGING_PARTICIPANT_JOINED', 'messaging.participant.joined.v1', principal, organizationId, organizationParticipant.id, eventContext, { conversationId: invitation.conversationId, organizationId });
        }
        const updated = await tx.messagingInvitation.updateMany({ where: { id: invitation.id, status: 'PENDING' }, data: { status: 'ACCEPTED', acceptedAt: new Date(), tokenDeliveredAt: new Date() } });
        if (updated.count !== 1) throw new ConflictException('Invitation is no longer valid');
        response = this.serialize({ ...invitation, status: 'ACCEPTED' });
        await this.recordMutation(tx, 'MESSAGING_INVITATION_ACCEPTED', `messaging.${invitation.type === 'USER' ? 'user' : 'organization'}_invitation.accepted.v1`, principal, organizationId, invitation.id, eventContext, { conversationId: invitation.conversationId, invitationType: invitation.type });
      } else {
        const updated = await tx.messagingInvitation.updateMany({ where: { id: invitation.id, status: 'PENDING' }, data: { status: 'DECLINED' } });
        if (updated.count !== 1) throw new ConflictException('Invitation is no longer valid');
        response = this.serialize({ ...invitation, status: 'DECLINED' });
        await this.recordMutation(tx, 'MESSAGING_INVITATION_DECLINED', `messaging.${invitation.type === 'USER' ? 'user' : 'organization'}_invitation.declined.v1`, principal, organizationId, invitation.id, eventContext, { conversationId: invitation.conversationId, invitationType: invitation.type });
      }
      await tx.messagingCommandReceipt.create({ data: { id: randomUUID(), organizationId, actorUserId: principal.userId, operation: `INVITATION_${decision}`, idempotencyKey: key, payloadHash, resourceType: 'MessagingInvitation', resourceId: invitation.id, responseJson: response as Prisma.InputJsonValue } });
      return decision === 'DECLINE' ? undefined : response;
    });
  }

  private assertInvitationActor(context: AuthorizationContext, type: string | undefined, targetUserId: string | null | undefined, actorUserId: string): void {
    if (!type) return;
    if (type === 'ORGANIZATION' && context.role !== 'OWNER' && context.role !== 'ADMIN') throw new ForbiddenException('Only an organization owner or admin can manage organization invitations');
    if (type === 'USER' && targetUserId !== actorUserId) throw new ForbiddenException('Invitation is addressed to another user');
  }

  private async findReceipt(tx: Prisma.TransactionClient, organizationId: string, actorUserId: string, operation: string, key: string, payloadHash: string): Promise<{ response: unknown } | null> {
    const receipt = await tx.messagingCommandReceipt.findUnique({ where: { organizationId_actorUserId_operation_idempotencyKey: { organizationId, actorUserId, operation, idempotencyKey: key } }, select: { payloadHash: true, responseJson: true } });
    if (!receipt) return null;
    if (receipt.payloadHash !== payloadHash) throw new ConflictException('Idempotency-Key was already used with a different command');
    return { response: receipt.responseJson };
  }

  private async recordMutation(tx: Prisma.TransactionClient, action: AuditAction, eventType: string, principal: AuthPrincipal, organizationId: string, targetId: string, context: Context, payload: Record<string, unknown>): Promise<void> {
    await tx.auditEvent.create({ data: { id: randomUUID(), action, actorUserId: principal.userId, organizationId, targetType: 'MessagingInvitation', targetId, requestId: context.requestId, correlationId: context.correlationId, metadataJson: payload as Prisma.InputJsonValue } });
    await this.outbox.enqueue(tx, createDomainEvent({ eventType, eventVersion: 1, occurredAt: new Date().toISOString(), actor: { type: 'USER', id: principal.userId }, aggregate: { type: 'MessagingInvitation', id: targetId }, organizationId, correlationId: context.correlationId, requestId: context.requestId, dataClassification: 'CONFIDENTIAL', purpose: 'messaging-audit', payload }));
  }

  private async recordParticipantMutation(tx: Prisma.TransactionClient, action: AuditAction, eventType: string, principal: AuthPrincipal, organizationId: string, targetId: string, context: Context, payload: Record<string, unknown>): Promise<void> {
    await tx.auditEvent.create({ data: { id: randomUUID(), action, actorUserId: principal.userId, organizationId, targetType: 'ConversationUserParticipant', targetId, requestId: context.requestId, correlationId: context.correlationId, metadataJson: payload as Prisma.InputJsonValue } });
    await this.outbox.enqueue(tx, createDomainEvent({ eventType, eventVersion: 1, occurredAt: new Date().toISOString(), actor: { type: 'USER', id: principal.userId }, aggregate: { type: 'ConversationUserParticipant', id: targetId }, organizationId, correlationId: context.correlationId, requestId: context.requestId, dataClassification: 'RESTRICTED', purpose: 'messaging-access-control', payload }));
  }

  private serialize(row: { id: string; type: string; conversationId: string; organizationId: string; targetOrganizationId: string; targetUserId: string | null; status: string; expiresAt: Date; createdAt: Date }): unknown { return { id: row.id, type: row.type, conversationId: row.conversationId, organizationId: row.targetOrganizationId, targetUserId: row.targetUserId, counterpartOrganizationId: row.organizationId, status: row.status, expiresAt: row.expiresAt.toISOString(), createdAt: row.createdAt.toISOString() }; }
  private requireKey(value?: string): string { if (!value?.trim() || value.length > 200 || /[\r\n]/.test(value)) throw new BadRequestException('Idempotency-Key is required and invalid'); return value.trim(); }
  private hash(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
  private eventContext(): Context { const context = currentEventContext(); return context?.requestId ? { requestId: context.requestId, correlationId: context.correlationId } : createRequestContext(); }
  private encodeCursor(cursor: Cursor): string { return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url'); }
  private decodeCursor(value: string): Cursor { try { const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Partial<Cursor>; if (typeof parsed.createdAt !== 'string' || typeof parsed.id !== 'string' || Number.isNaN(Date.parse(parsed.createdAt))) throw new Error(); return { createdAt: parsed.createdAt, id: parsed.id }; } catch { throw new BadRequestException('Cursor is invalid'); } }
}
