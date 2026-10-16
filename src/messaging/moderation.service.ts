import { randomUUID } from 'node:crypto';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type AuditAction, type MessagingConversationStatus } from '@prisma/client';
import type { AuthPrincipal } from '../auth/auth.types.js';
import { PlatformAuthorizationService } from '../entitlements/platform-authorization.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { createDomainEvent } from '../events/domain-event.factory.js';
import { createRequestContext, currentEventContext } from '../events/event-context.js';
import { PrismaOutboxWriter } from '../events/prisma-outbox.writer.js';

@Injectable()
export class MessagingModerationService {
  constructor(private readonly prisma: PrismaService, private readonly platformAuthorization: PlatformAuthorizationService, private readonly outbox: PrismaOutboxWriter) {}

  suspend(principal: AuthPrincipal, conversationId: string, reason: string): Promise<unknown> {
    return this.setStatus(principal, conversationId, 'SUSPENDED', reason);
  }

  resume(principal: AuthPrincipal, conversationId: string, reason: string): Promise<unknown> {
    return this.setStatus(principal, conversationId, 'OPEN', reason);
  }

  private async setStatus(principal: AuthPrincipal, conversationId: string, status: MessagingConversationStatus, rawReason: string): Promise<unknown> {
    this.platformAuthorization.assertPlatformAdmin(principal);
    const reason = rawReason.trim();
    if (!reason || reason.length > 500) throw new BadRequestException('Moderation reason is required and must be at most 500 characters');
    const context = currentEventContext() ?? createRequestContext();
    const requestId = context.requestId ?? 'unknown';
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`SELECT id FROM "conversations" WHERE id = ${conversationId}::uuid FOR UPDATE`);
      const current = await tx.conversation.findUnique({ where: { id: conversationId }, select: { id: true, status: true, organizationLowId: true, organizationHighId: true, updatedAt: true } });
      if (!current) throw new NotFoundException('Conversation not found');
      if (current.status === status) return { id: current.id, status: current.status, updatedAt: current.updatedAt.toISOString() };
      const updated = await tx.conversation.update({ where: { id: conversationId }, data: { status }, select: { id: true, status: true, organizationLowId: true, organizationHighId: true, updatedAt: true } });
      const suspended = status === 'SUSPENDED';
      const action: AuditAction = suspended ? 'MESSAGING_CONVERSATION_SUSPENDED' : 'MESSAGING_CONVERSATION_RESUMED';
      const eventType = suspended ? 'messaging.conversation.suspended.v1' : 'messaging.conversation.resumed.v1';
      const payload = { conversationId, previousStatus: current.status, status: updated.status, reason };
      await tx.auditEvent.create({ data: { id: randomUUID(), action, actorUserId: principal.userId, organizationId: current.organizationLowId, targetType: 'Conversation', targetId: conversationId, requestId: context.requestId ?? null, correlationId: context.correlationId, metadataJson: payload } });
      await this.outbox.enqueue(tx, createDomainEvent({ eventType, eventVersion: 1, occurredAt: new Date().toISOString(), actor: { type: 'PLATFORM', id: principal.userId }, aggregate: { type: 'Conversation', id: conversationId }, organizationId: current.organizationLowId, correlationId: context.correlationId, requestId, dataClassification: 'RESTRICTED', purpose: 'messaging-moderation', payload }));
      return { id: updated.id, status: updated.status, updatedAt: updated.updatedAt.toISOString() };
    });
  }
}
