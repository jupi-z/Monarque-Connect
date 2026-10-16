import { createHash, randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service.js';
import { PrismaOutboxWriter } from '../events/prisma-outbox.writer.js';
import { createDomainEvent } from '../events/domain-event.factory.js';
import { createRequestContext, currentEventContext } from '../events/event-context.js';
import type { AuthPrincipal } from '../auth/auth.types.js';
import { MessagingAuthorization } from './messaging.authorization.js';
import { MessagingPolicy } from '../network/messaging-policy.service.js';
import type { MessageListQuery, SendMessageDto } from './message.dto.js';
import { MessagingAbuseService } from './abuse.service.js';
import { MessagingRateLimitException } from './messaging-rate-limit.exception.js';

type Cursor = { sequence: string; id: string; conversationId: string };
type Context = { requestId: string; correlationId: string };

const messageSelect = {
  id: true,
  conversationId: true,
  sequence: true,
  authorUserId: true,
  sourceOrganizationId: true,
  clientMessageId: true,
  body: true,
  createdAt: true,
} as const;

@Injectable()
export class MessageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly messagingAuthorization: MessagingAuthorization,
    private readonly policy: MessagingPolicy,
    private readonly outbox: PrismaOutboxWriter,
    private readonly abuse: MessagingAbuseService,
  ) {}

  async send(principal: AuthPrincipal, organizationId: string, conversationId: string, input: SendMessageDto, rawKey?: string): Promise<unknown> {
    await this.messagingAuthorization.requireParticipantAccess(principal, organizationId, conversationId, 'messaging:write');
    const key = this.requireKey(rawKey);
    if (!input.body.trim()) throw new BadRequestException('Message body cannot be blank');
    const payloadHash = this.hash({ operation: 'MESSAGE_SEND', organizationId, conversationId, input });
    const context = this.eventContext();

    const result = await this.prisma.$transaction(async (tx) => {
      const replay = await this.findReceipt(tx, organizationId, principal.userId, 'MESSAGE_SEND', key, payloadHash);
      if (replay) return replay.response;

      await tx.$executeRaw(Prisma.sql`SELECT id FROM "conversations" WHERE id = ${conversationId}::uuid FOR UPDATE`);
      const sendPolicy = await this.policy.assertCanSend(tx, principal, conversationId);
      if (sendPolicy.sourceOrganizationId !== organizationId) throw new NotFoundException('Conversation not found');
      const reservation = await this.abuse.reserve(tx, { actorUserId: principal.userId, organizationId, targetOrganizationId: sendPolicy.targetOrganizationId, conversationId, body: input.body });
      if (!reservation.allowed) {
        const response = { rateLimited: true, retryAfterSeconds: reservation.retryAfterSeconds };
        await tx.auditEvent.create({ data: { id: randomUUID(), action: 'MESSAGING_ABUSE_THRESHOLD_EXCEEDED', actorUserId: principal.userId, organizationId, targetType: 'Conversation', targetId: conversationId, requestId: context.requestId, correlationId: context.correlationId, metadataJson: { conversationId, dimensions: reservation.dimensions, retryAfterSeconds: reservation.retryAfterSeconds } } });
        await this.outbox.enqueue(tx, createDomainEvent({ eventType: 'messaging.abuse.threshold_exceeded.v1', eventVersion: 1, occurredAt: new Date().toISOString(), actor: { type: 'USER', id: principal.userId }, aggregate: { type: 'Conversation', id: conversationId }, organizationId, correlationId: context.correlationId, requestId: context.requestId, dataClassification: 'RESTRICTED', purpose: 'messaging-anti-abuse', payload: { conversationId, dimensions: reservation.dimensions, retryAfterSeconds: reservation.retryAfterSeconds } }));
        await tx.messagingCommandReceipt.create({ data: { id: randomUUID(), organizationId, actorUserId: principal.userId, operation: 'MESSAGE_SEND', idempotencyKey: key, payloadHash, resourceType: 'MessagingRateLimit', resourceId: conversationId, responseJson: response } });
        return response;
      }
      const sequenceRow = await tx.conversation.update({
        where: { id: conversationId },
        data: { lastMessageSequence: { increment: 1n } },
        select: { lastMessageSequence: true },
      });
      const message = await tx.message.create({
        data: {
          id: randomUUID(),
          conversationId,
          sequence: sequenceRow.lastMessageSequence,
          authorUserId: principal.userId,
          sourceOrganizationId: organizationId,
          clientMessageId: input.clientMessageId,
          body: input.body,
        },
        select: messageSelect,
      });
      const response = this.serialize(message);
      await tx.auditEvent.create({
        data: {
          id: randomUUID(),
          action: 'MESSAGING_MESSAGE_SENT',
          actorUserId: principal.userId,
          organizationId,
          targetType: 'Message',
          targetId: message.id,
          requestId: context.requestId,
          correlationId: context.correlationId,
          metadataJson: { conversationId, sequence: message.sequence.toString(), clientMessageId: input.clientMessageId },
        },
      });
      await this.outbox.enqueue(tx, createDomainEvent({
        eventType: 'messaging.message.sent.v1',
        eventVersion: 1,
        occurredAt: new Date().toISOString(),
        actor: { type: 'USER', id: principal.userId },
        aggregate: { type: 'Message', id: message.id },
        organizationId,
        correlationId: context.correlationId,
        requestId: context.requestId,
        dataClassification: 'CONFIDENTIAL',
        purpose: 'messaging-message',
        payload: { conversationId, messageId: message.id, sequence: message.sequence.toString(), sourceOrganizationId: organizationId },
      }));
      await tx.messagingCommandReceipt.create({
        data: {
          id: randomUUID(),
          organizationId,
          actorUserId: principal.userId,
          operation: 'MESSAGE_SEND',
          idempotencyKey: key,
          payloadHash,
          resourceType: 'Message',
          resourceId: message.id,
          responseJson: response as Prisma.InputJsonValue,
        },
      });
      return response;
    }).catch((error: unknown) => {
      if (this.isUnique(error)) throw new ConflictException('Message or idempotency key already exists');
      throw error;
    });
    if (this.isRateLimited(result)) throw new MessagingRateLimitException(result.retryAfterSeconds);
    return result;
  }

  async list(principal: AuthPrincipal, organizationId: string, conversationId: string, query: MessageListQuery): Promise<unknown> {
    const access = await this.messagingAuthorization.requireParticipantAccess(principal, organizationId, conversationId, 'messaging:read');
    const limit = query.limit ?? 20;
    const cursor = query.cursor ? this.decodeCursor(query.cursor, conversationId) : undefined;
    const rows = await this.prisma.message.findMany({
      where: {
        conversationId,
        sequence: { gte: access.participant.historyVisibleFromSequence, ...(cursor ? { gt: BigInt(cursor.sequence) } : {}) },
      },
      orderBy: [{ sequence: 'asc' }, { id: 'asc' }],
      take: limit + 1,
      select: messageSelect,
    });
    const items = rows.slice(0, limit).map((row) => this.serialize(row));
    const next = rows.length > limit ? rows[limit - 1] : undefined;
    return { items, nextCursor: next ? this.encodeCursor({ sequence: next.sequence.toString(), id: next.id, conversationId }) : null };
  }

  private async findReceipt(tx: Prisma.TransactionClient, organizationId: string, actorUserId: string, operation: string, key: string, payloadHash: string): Promise<{ response: unknown } | null> {
    const receipt = await tx.messagingCommandReceipt.findUnique({ where: { organizationId_actorUserId_operation_idempotencyKey: { organizationId, actorUserId, operation, idempotencyKey: key } }, select: { payloadHash: true, responseJson: true } });
    if (!receipt) return null;
    if (receipt.payloadHash !== payloadHash) throw new ConflictException('Idempotency-Key was already used with a different command');
    return { response: receipt.responseJson };
  }

  private serialize(row: { id: string; conversationId: string; sequence: bigint; authorUserId: string; sourceOrganizationId: string; clientMessageId: string; body: string; createdAt: Date }): unknown {
    return { ...row, sequence: Number(row.sequence), createdAt: row.createdAt.toISOString() };
  }

  private requireKey(value?: string): string { if (!value?.trim() || value.length > 200 || /[\r\n]/.test(value)) throw new BadRequestException('Idempotency-Key is required and invalid'); return value.trim(); }
  private hash(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
  private eventContext(): Context { const context = currentEventContext(); return context?.requestId ? { requestId: context.requestId, correlationId: context.correlationId } : createRequestContext(); }
  private encodeCursor(cursor: Cursor): string { return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url'); }
  private decodeCursor(value: string, conversationId: string): Cursor { try { const cursor = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Partial<Cursor>; if (cursor.conversationId !== conversationId || typeof cursor.id !== 'string' || typeof cursor.sequence !== 'string' || !/^\d+$/.test(cursor.sequence)) throw new Error(); return { conversationId, id: cursor.id, sequence: cursor.sequence }; } catch { throw new BadRequestException('Cursor is invalid'); } }
  private isUnique(error: unknown): boolean { return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'; }
  private isRateLimited(value: unknown): value is { rateLimited: true; retryAfterSeconds: number } { return typeof value === 'object' && value !== null && 'rateLimited' in value && (value as { rateLimited?: unknown }).rateLimited === true && typeof (value as { retryAfterSeconds?: unknown }).retryAfterSeconds === 'number'; }
}
