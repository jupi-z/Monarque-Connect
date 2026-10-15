import { createHash, randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type AuditAction } from '@prisma/client';
import { PrismaService } from '../database/prisma.service.js';
import { PrismaOutboxWriter } from '../events/prisma-outbox.writer.js';
import { createDomainEvent } from '../events/domain-event.factory.js';
import { createRequestContext, currentEventContext } from '../events/event-context.js';
import type { AuthPrincipal } from '../auth/auth.types.js';
import { AuthorizationService } from '../tenancy/authorization.service.js';
import { MessagingAuthorization } from './messaging.authorization.js';
import { MessagingPolicy } from '../network/messaging-policy.service.js';
import type { ConversationListQuery, CreateConversationDto } from './conversation.dto.js';
import { encryptInvitationToken, tokenDigest, tokenExpiry } from './invitation-token.js';

type Cursor = { updatedAt: string; id: string };
type Context = { requestId: string; correlationId: string };

const conversationSelect = { id: true, organizationLowId: true, organizationHighId: true, status: true, lastMessageSequence: true, createdAt: true, updatedAt: true } as const;

@Injectable()
export class ConversationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorization: AuthorizationService,
    private readonly messagingAuthorization: MessagingAuthorization,
    private readonly policy: MessagingPolicy,
    private readonly outbox: PrismaOutboxWriter,
  ) {}

  async list(principal: AuthPrincipal, organizationId: string, query: ConversationListQuery): Promise<unknown> {
    const context = await this.authorization.requireModule(principal, organizationId, 'MESSAGING', 'messaging:read');
    const limit = query.limit ?? 20;
    const cursor = query.cursor ? this.decodeCursor(query.cursor) : undefined;
    const scope = context.scopeMode === 'SELECTED_ESTABLISHMENTS'
      ? { OR: [{ establishmentId: null }, { establishmentId: { in: context.establishmentIds as string[] } }] }
      : {};
    const rows = await this.prisma.conversation.findMany({
      where: {
        userParticipants: { some: { organizationId, userId: principal.userId, status: 'ACTIVE' } },
        organizationParticipants: { some: { organizationId, status: 'ACTIVE', ...scope } },
        ...(cursor ? { OR: [{ updatedAt: { gt: new Date(cursor.updatedAt) } }, { updatedAt: new Date(cursor.updatedAt), id: { gt: cursor.id } }] } : {}),
      },
      orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
      take: limit + 1,
      select: conversationSelect,
    });
    const items = rows.slice(0, limit).map((row) => this.serialize(row, organizationId, 'ACTIVE'));
    const next = rows.length > limit ? rows[limit - 1] : undefined;
    return { items, nextCursor: next ? this.encodeCursor({ updatedAt: next.updatedAt.toISOString(), id: next.id }) : null };
  }

  async get(principal: AuthPrincipal, organizationId: string, conversationId: string): Promise<unknown> {
    const participant = await this.messagingAuthorization.requireParticipantAccess(principal, organizationId, conversationId, 'messaging:read');
    const row = await this.prisma.conversation.findFirst({ where: { id: conversationId }, select: conversationSelect });
    if (!row) throw new NotFoundException('Conversation not found');
    return this.serialize(row, organizationId, participant.participant.status);
  }

  async create(principal: AuthPrincipal, organizationId: string, input: CreateConversationDto, rawKey?: string): Promise<unknown> {
    const context = await this.authorization.requireModule(principal, organizationId, 'MESSAGING', 'messaging:write');
    const key = this.requireKey(rawKey);
    const payloadHash = this.hash({ operation: 'CONVERSATION_CREATE', organizationId, input });
    const eventContext = this.eventContext();
    const low = [organizationId, input.targetOrganizationId].sort()[0]!;
    const high = [organizationId, input.targetOrganizationId].sort()[1]!;
    try {
      return await this.prisma.$transaction(async (tx) => {
        const replay = await this.findReceipt(tx, organizationId, principal.userId, 'CONVERSATION_CREATE', key, payloadHash);
        if (replay) return replay.response;
        if (input.sourceEstablishmentId) await this.authorization.assertEstablishment(context, input.sourceEstablishmentId);
        await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${low}:${high}`}, 0))`);
        await this.policy.assertCanInitiate(tx, principal, organizationId, input.targetOrganizationId);
        const existing = await tx.conversation.findUnique({ where: { organizationLowId_organizationHighId: { organizationLowId: low, organizationHighId: high } }, select: { id: true } });
        if (existing) throw new ConflictException('A conversation already exists for these organizations');
        const conversationId = randomUUID();
        const now = new Date();
        const invitationId = randomUUID();
        const token = randomUUID().replaceAll('-', '') + randomUUID().replaceAll('-', '');
        const tokenExpiresAt = tokenExpiry();
        const invitationExpiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
        const conversation = await tx.conversation.create({ data: { id: conversationId, organizationLowId: low, organizationHighId: high, createdByUserId: principal.userId }, select: conversationSelect });
        await tx.conversationOrganizationParticipant.createMany({ data: [
          { id: randomUUID(), conversationId, organizationId, establishmentId: input.sourceEstablishmentId ?? null, status: 'ACTIVE', joinedAt: now, historyVisibleFromSequence: 0n, createdByUserId: principal.userId },
          { id: randomUUID(), conversationId, organizationId: input.targetOrganizationId, establishmentId: null, status: 'ACTIVE', joinedAt: null, historyVisibleFromSequence: conversation.lastMessageSequence + 1n, createdByUserId: principal.userId },
        ] });
        await tx.conversationUserParticipant.create({ data: { id: randomUUID(), conversationId, organizationId, userId: principal.userId, status: 'ACTIVE', joinedAt: now, historyVisibleFromSequence: 0n } });
        await tx.messagingInvitation.create({ data: { id: invitationId, type: 'ORGANIZATION', conversationId, organizationId, targetOrganizationId: input.targetOrganizationId, tokenDigest: tokenDigest(token), tokenCiphertext: encryptInvitationToken(token), tokenIssuedAt: now, tokenExpiresAt, expiresAt: invitationExpiresAt, createdByUserId: principal.userId } });
        await this.recordMutation(tx, 'MESSAGING_CONVERSATION_CREATED', 'messaging.conversation.created.v1', principal, organizationId, conversationId, eventContext, { counterpartOrganizationId: input.targetOrganizationId });
        await this.recordMutation(tx, 'MESSAGING_INVITATION_CREATED', 'messaging.organization_invitation.created.v1', principal, organizationId, invitationId, eventContext, { conversationId, targetOrganizationId: input.targetOrganizationId });
        const response = this.serialize(conversation, organizationId, 'ACTIVE');
        await tx.messagingCommandReceipt.create({ data: { id: randomUUID(), organizationId, actorUserId: principal.userId, operation: 'CONVERSATION_CREATE', idempotencyKey: key, payloadHash, resourceType: 'Conversation', resourceId: conversationId, responseJson: response as Prisma.InputJsonValue } });
        return response;
      });
    } catch (error) {
      if (this.isUnique(error)) throw new ConflictException('A conversation already exists or the idempotency key is already used');
      throw error;
    }
  }

  private async findReceipt(tx: Prisma.TransactionClient, organizationId: string, actorUserId: string, operation: string, key: string, payloadHash: string): Promise<{ resourceId: string; response: unknown } | null> {
    const receipt = await tx.messagingCommandReceipt.findUnique({ where: { organizationId_actorUserId_operation_idempotencyKey: { organizationId, actorUserId, operation, idempotencyKey: key } }, select: { resourceId: true, payloadHash: true, responseJson: true } });
    if (!receipt) return null;
    if (receipt.payloadHash !== payloadHash) throw new ConflictException('Idempotency-Key was already used with a different command');
    return { resourceId: receipt.resourceId, response: receipt.responseJson };
  }

  private async recordMutation(tx: Prisma.TransactionClient, action: AuditAction, eventType: string, principal: AuthPrincipal, organizationId: string, targetId: string, context: Context, payload: Record<string, unknown>): Promise<void> {
    await tx.auditEvent.create({ data: { id: randomUUID(), action, actorUserId: principal.userId, organizationId, targetType: 'Messaging', targetId, requestId: context.requestId, correlationId: context.correlationId, metadataJson: payload as Prisma.InputJsonValue } });
    await this.outbox.enqueue(tx, createDomainEvent({ eventType, eventVersion: 1, occurredAt: new Date().toISOString(), actor: { type: 'USER', id: principal.userId }, aggregate: { type: 'Messaging', id: targetId }, organizationId, correlationId: context.correlationId, requestId: context.requestId, dataClassification: 'CONFIDENTIAL', purpose: 'messaging-audit', payload }));
  }

  private serialize(row: { id: string; organizationLowId: string; organizationHighId: string; status: string; lastMessageSequence: bigint; createdAt: Date; updatedAt: Date }, organizationId: string, participantStatus: string): unknown {
    return { id: row.id, organizationId, counterpartOrganizationId: row.organizationLowId === organizationId ? row.organizationHighId : row.organizationLowId, status: row.status, participantStatus, lastMessageSequence: Number(row.lastMessageSequence), createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
  }

  private requireKey(value?: string): string { if (!value?.trim() || value.length > 200 || /[\r\n]/.test(value)) throw new BadRequestException('Idempotency-Key is required and invalid'); return value.trim(); }
  private hash(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
  private eventContext(): Context { const context = currentEventContext(); return context?.requestId ? { requestId: context.requestId, correlationId: context.correlationId } : createRequestContext(); }
  private encodeCursor(cursor: Cursor): string { return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url'); }
  private decodeCursor(value: string): Cursor { try { const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Partial<Cursor>; if (typeof parsed.updatedAt !== 'string' || typeof parsed.id !== 'string' || Number.isNaN(Date.parse(parsed.updatedAt))) throw new Error(); return { updatedAt: parsed.updatedAt, id: parsed.id }; } catch { throw new BadRequestException('Cursor is invalid'); } }
  private isUnique(error: unknown): boolean { return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'; }
}
