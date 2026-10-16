import { createHash, randomUUID } from 'node:crypto';
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthPrincipal } from '../auth/auth.types.js';
import { PrismaService } from '../database/prisma.service.js';
import { createDomainEvent } from '../events/domain-event.factory.js';
import { createRequestContext, currentEventContext } from '../events/event-context.js';
import { PrismaOutboxWriter } from '../events/prisma-outbox.writer.js';
import { MessagingAuthorization } from './messaging.authorization.js';
import type { BlockConversationDto } from './block.dto.js';

@Injectable()
export class MessagingBlockService {
  constructor(private readonly prisma: PrismaService, private readonly authorization: MessagingAuthorization, private readonly outbox: PrismaOutboxWriter) {}

  async block(principal: AuthPrincipal, organizationId: string, conversationId: string, input: BlockConversationDto, rawKey?: string): Promise<void> {
    await this.authorization.requireParticipantAccess(principal, organizationId, conversationId, 'messaging:block:write');
    const key = this.requireKey(rawKey);
    const reason = input.reason.trim();
    const payloadHash = this.hash({ operation: 'BLOCK', organizationId, conversationId, reason });
    const result = await this.prisma.$transaction((tx) => this.mutate(tx, 'BLOCK', principal, organizationId, conversationId, reason, key, payloadHash));
    if (result === 'conflict') throw new ConflictException('Idempotency-Key was already used with a different command');
  }

  async unblock(principal: AuthPrincipal, organizationId: string, conversationId: string, rawKey?: string): Promise<void> {
    await this.authorization.requireParticipantAccess(principal, organizationId, conversationId, 'messaging:block:write');
    const key = this.requireKey(rawKey);
    const payloadHash = this.hash({ operation: 'UNBLOCK', organizationId, conversationId });
    const result = await this.prisma.$transaction((tx) => this.mutate(tx, 'UNBLOCK', principal, organizationId, conversationId, null, key, payloadHash));
    if (result === 'conflict') throw new ConflictException('Idempotency-Key was already used with a different command');
  }

  private async mutate(tx: Prisma.TransactionClient, operation: 'BLOCK' | 'UNBLOCK', principal: AuthPrincipal, organizationId: string, conversationId: string, reason: string | null, key: string, payloadHash: string): Promise<'ok' | 'conflict'> {
    const existingReceipt = await tx.messagingCommandReceipt.findUnique({ where: { organizationId_actorUserId_operation_idempotencyKey: { organizationId, actorUserId: principal.userId, operation: `MESSAGE_${operation}`, idempotencyKey: key } }, select: { payloadHash: true } });
    if (existingReceipt) return existingReceipt.payloadHash === payloadHash ? 'ok' : 'conflict';
    await tx.$executeRaw(Prisma.sql`SELECT id FROM "conversations" WHERE id = ${conversationId}::uuid FOR UPDATE`);
    const conversation = await tx.conversation.findFirst({ where: { id: conversationId, OR: [{ organizationLowId: organizationId }, { organizationHighId: organizationId }] }, select: { id: true, organizationLowId: true, organizationHighId: true } });
    if (!conversation) throw new NotFoundException('Conversation not found');
    const targetOrganizationId = conversation.organizationLowId === organizationId ? conversation.organizationHighId : conversation.organizationLowId;
    const now = new Date();
    const current = await tx.messagingOrganizationBlock.findUnique({ where: { sourceOrganizationId_targetOrganizationId: { sourceOrganizationId: organizationId, targetOrganizationId } }, select: { id: true, active: true } });
    const activate = operation === 'BLOCK';
    const block = current ? await tx.messagingOrganizationBlock.update({ where: { id: current.id }, data: activate ? { active: true, reason: reason ?? null, revokedAt: null } : { active: false, revokedAt: now }, select: { id: true } }) : activate ? await tx.messagingOrganizationBlock.create({ data: { id: randomUUID(), sourceOrganizationId: organizationId, targetOrganizationId, createdByUserId: principal.userId, reason }, select: { id: true } }) : null;
    const context = currentEventContext() ?? createRequestContext();
    const requestId = context.requestId ?? 'unknown';
    if (block && (current?.active ?? false) !== activate) {
      await tx.auditEvent.create({ data: { id: randomUUID(), action: activate ? 'MESSAGING_BLOCK_CREATED' : 'MESSAGING_BLOCK_REVOKED', actorUserId: principal.userId, organizationId, targetType: 'MessagingOrganizationBlock', targetId: block.id, requestId: context.requestId ?? null, correlationId: context.correlationId, metadataJson: { conversationId, targetOrganizationId, reason } } });
      await this.outbox.enqueue(tx, createDomainEvent({ eventType: activate ? 'messaging.relation.blocked.v1' : 'messaging.relation.unblocked.v1', eventVersion: 1, occurredAt: now.toISOString(), actor: { type: 'USER', id: principal.userId }, aggregate: { type: 'MessagingOrganizationBlock', id: block.id }, organizationId, correlationId: context.correlationId, requestId, dataClassification: 'RESTRICTED', purpose: 'messaging-access-control', payload: { conversationId, sourceOrganizationId: organizationId, targetOrganizationId, active: activate } }));
    }
    await tx.messagingCommandReceipt.create({ data: { id: randomUUID(), organizationId, actorUserId: principal.userId, operation: `MESSAGE_${operation}`, idempotencyKey: key, payloadHash, resourceType: 'MessagingOrganizationBlock', resourceId: block?.id ?? conversationId, responseJson: { active: activate } } });
    return 'ok';
  }

  private requireKey(value?: string): string { if (!value?.trim() || value.length > 200 || /[\r\n]/.test(value)) throw new ConflictException('Idempotency-Key is required and invalid'); return value.trim(); }
  private hash(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
}
