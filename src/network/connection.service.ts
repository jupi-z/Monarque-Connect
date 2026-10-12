import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type AuditAction, type ConnectionRequestStatus } from '@prisma/client';
import { PrismaService } from '../database/prisma.service.js';
import { createDomainEvent } from '../events/domain-event.factory.js';
import { createRequestContext, currentEventContext } from '../events/event-context.js';
import { PrismaOutboxWriter } from '../events/prisma-outbox.writer.js';
import type { AuthPrincipal } from '../auth/auth.types.js';
import { AuthorizationService } from '../tenancy/authorization.service.js';
import { EffectiveEntitlementsService } from '../entitlements/effective-entitlements.service.js';
import type { ConnectionRequestListQuery, CreateConnectionRequestDto } from './connection.dto.js';

type ConnectionCursor = { createdAt: string; id: string };

@Injectable()
export class ConnectionRequestService {
  constructor(private readonly prisma: PrismaService, private readonly authorization: AuthorizationService, private readonly outbox: PrismaOutboxWriter, private readonly entitlements: EffectiveEntitlementsService) {}

  async create(principal: AuthPrincipal, organizationId: string, input: CreateConnectionRequestDto): Promise<unknown> {
    await this.authorization.requireModule(principal, organizationId, 'NETWORK_CONNECTIONS', 'network:connections:write');
    if (organizationId === input.targetOrganizationId) throw new ConflictException('An organization cannot connect to itself');
    const target = await this.prisma.organization.findFirst({ where: { id: input.targetOrganizationId, status: 'ACTIVE', networkProfile: { isPublic: true } }, select: { id: true } });
    if (!target) throw new ConflictException('Target organization is not available for connection');
    const targetCapabilities = (await this.entitlements.resolve(target.id)).modules.find((module) => module.code === 'NETWORK_CONNECTIONS');
    if (!targetCapabilities?.allowed) throw new ConflictException('Target organization cannot receive connections');

    const context = this.context();
    try {
      return await this.prisma.$transaction(async (tx) => {
        const pairKey = [organizationId, target.id].sort().join(':');
        await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${pairKey}, 0))`);
        const existing = await tx.connectionRequest.findFirst({ where: { OR: [{ sourceOrganizationId: organizationId, targetOrganizationId: target.id }, { sourceOrganizationId: target.id, targetOrganizationId: organizationId }], status: { in: ['PENDING', 'ACCEPTED'] } }, select: { id: true } });
        if (existing) throw new ConflictException('A connection request already exists for these organizations');
        const request = await tx.connectionRequest.create({ data: { id: randomUUID(), sourceOrganizationId: organizationId, targetOrganizationId: target.id, message: input.message?.trim() || null }, select: this.select });
        await this.recordMutation(tx, 'CONNECTION_REQUEST_CREATED', 'network.connection.requested', principal, organizationId, request.id, context, { sourceOrganizationId: organizationId, targetOrganizationId: target.id, status: request.status });
        return this.serialize(request);
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('A connection request already exists for these organizations');
      throw error;
    }
  }

  async list(principal: AuthPrincipal, organizationId: string, query: ConnectionRequestListQuery): Promise<unknown> {
    await this.authorization.requireModule(principal, organizationId, 'NETWORK_CONNECTIONS', 'network:connections:read');
    const limit = query.limit ?? 20;
    const cursor = query.cursor ? this.decodeCursor(query.cursor) : undefined;
    const rows = await this.prisma.connectionRequest.findMany({
      where: { AND: [{ OR: [{ sourceOrganizationId: organizationId }, { targetOrganizationId: organizationId }] }, ...(query.status ? [{ status: query.status }] : []), ...(cursor ? [{ OR: [{ createdAt: { gt: new Date(cursor.createdAt) } }, { createdAt: new Date(cursor.createdAt), id: { gt: cursor.id } }] }] : [])] },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: limit + 1,
      select: this.select,
    });
    const items = rows.slice(0, limit).map((request) => this.serialize(request));
    const next = rows.length > limit ? rows[limit - 1] : undefined;
    return { items, nextCursor: next ? this.encodeCursor({ createdAt: next.createdAt.toISOString(), id: next.id }) : null };
  }

  async updateStatus(principal: AuthPrincipal, organizationId: string, requestId: string, status: 'ACCEPTED' | 'DECLINED' | 'CANCELLED'): Promise<unknown> {
    await this.authorization.requireModule(principal, organizationId, 'NETWORK_CONNECTIONS', 'network:connections:write');
    const current = await this.prisma.connectionRequest.findUnique({ where: { id: requestId }, select: this.select });
    if (!current) throw new NotFoundException('Connection request not found');
    const isSource = current.sourceOrganizationId === organizationId;
    const isTarget = current.targetOrganizationId === organizationId;
    if (!isSource && !isTarget) throw new ForbiddenException('Connection request access denied');
    if ((isSource && status !== 'CANCELLED') || (isTarget && status === 'CANCELLED')) throw new ForbiddenException('Invalid connection request transition authority');
    if (current.status === status) return this.serialize(current);
    if (current.status !== 'PENDING') throw new ConflictException('Connection request is already finalized');
    const eventContext = this.context();
    return this.prisma.$transaction(async (tx) => {
      const changed = await tx.connectionRequest.updateMany({ where: { id: requestId, status: 'PENDING', OR: [{ sourceOrganizationId: organizationId }, { targetOrganizationId: organizationId }] }, data: { status } });
      if (changed.count === 0) {
        const latest = await tx.connectionRequest.findUnique({ where: { id: requestId }, select: this.select });
        if (!latest) throw new NotFoundException('Connection request not found');
        if (latest.status === status) return this.serialize(latest);
        throw new ConflictException('Connection request was changed concurrently');
      }
      const updated = await tx.connectionRequest.findUniqueOrThrow({ where: { id: requestId }, select: this.select });
      await this.recordMutation(tx, 'CONNECTION_REQUEST_STATUS_CHANGED', 'network.connection.status_changed', principal, organizationId, requestId, eventContext, { previousStatus: current.status, status: updated.status, sourceOrganizationId: updated.sourceOrganizationId, targetOrganizationId: updated.targetOrganizationId });
      return this.serialize(updated);
    });
  }

  private async recordMutation(tx: Prisma.TransactionClient, action: AuditAction, eventType: string, principal: AuthPrincipal, organizationId: string, requestId: string, context: { requestId: string; correlationId: string }, payload: Record<string, unknown>): Promise<void> {
    await tx.auditEvent.create({ data: { id: randomUUID(), action, actorUserId: principal.userId, organizationId, targetType: 'ConnectionRequest', targetId: requestId, requestId: context.requestId, correlationId: context.correlationId, metadataJson: payload as Prisma.InputJsonValue } });
    await this.outbox.enqueue(tx, createDomainEvent({ eventType, eventVersion: 1, occurredAt: new Date().toISOString(), actor: { type: 'USER', id: principal.userId }, aggregate: { type: 'ConnectionRequest', id: requestId }, organizationId, correlationId: context.correlationId, requestId: context.requestId, dataClassification: 'CONFIDENTIAL', purpose: 'network-connection', payload }));
  }

  private context(): { requestId: string; correlationId: string } { const current = currentEventContext(); return current?.requestId ? { requestId: current.requestId, correlationId: current.correlationId } : createRequestContext(); }
  private encodeCursor(cursor: ConnectionCursor): string { return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url'); }
  private decodeCursor(value: string): ConnectionCursor { try { const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Partial<ConnectionCursor>; if (typeof parsed.createdAt !== 'string' || typeof parsed.id !== 'string' || Number.isNaN(Date.parse(parsed.createdAt))) throw new Error('invalid'); return { createdAt: parsed.createdAt, id: parsed.id }; } catch { throw new BadRequestException('Cursor is invalid'); } }
  private serialize(request: { id: string; sourceOrganizationId: string; targetOrganizationId: string; status: ConnectionRequestStatus; message: string | null; createdAt: Date; updatedAt: Date }): unknown { return { id: request.id, sourceOrganizationId: request.sourceOrganizationId, targetOrganizationId: request.targetOrganizationId, status: request.status, message: request.message, createdAt: request.createdAt.toISOString(), updatedAt: request.updatedAt.toISOString() }; }
  private readonly select = { id: true, sourceOrganizationId: true, targetOrganizationId: true, status: true, message: true, createdAt: true, updatedAt: true } as const;
}
