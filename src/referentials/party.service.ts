import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type AuditAction } from '@prisma/client';
import { PrismaService } from '../database/prisma.service.js';
import { createDomainEvent } from '../events/domain-event.factory.js';
import { createRequestContext, currentEventContext } from '../events/event-context.js';
import { PrismaOutboxWriter } from '../events/prisma-outbox.writer.js';
import type { AuthPrincipal } from '../auth/auth.types.js';
import { AuthorizationService } from '../tenancy/authorization.service.js';
import type { CreatePartyDto, PartyListQuery, UpdatePartyDto } from './party.dto.js';

type PartyCursor = { createdAt: string; id: string };

@Injectable()
export class PartyService {
  constructor(private readonly prisma: PrismaService, private readonly authorization: AuthorizationService, private readonly outbox: PrismaOutboxWriter) {}

  async list(principal: AuthPrincipal, organizationId: string, query: PartyListQuery): Promise<unknown> {
    await this.authorization.requireModule(principal, organizationId, 'CRM', 'parties:read');
    const limit = query.limit ?? 20;
    const cursor = query.cursor ? this.decodeCursor(query.cursor) : undefined;
    const rows = await this.prisma.businessParty.findMany({
      where: {
        organizationId,
        ...(query.type ? { type: query.type } : {}),
        ...(query.active === undefined ? {} : { active: query.active }),
        ...(query.search ? { displayName: { contains: query.search.trim(), mode: 'insensitive' } } : {}),
        ...(cursor ? { OR: [{ createdAt: { gt: new Date(cursor.createdAt) } }, { createdAt: new Date(cursor.createdAt), id: { gt: cursor.id } }] } : {}),
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: limit + 1,
      select: this.select,
    });
    const items = rows.slice(0, limit).map((party) => this.serialize(party));
    const next = rows.length > limit ? rows[limit - 1] : undefined;
    return { items, nextCursor: next ? this.encodeCursor({ createdAt: next.createdAt.toISOString(), id: next.id }) : null };
  }

  async get(principal: AuthPrincipal, organizationId: string, partyId: string): Promise<unknown> {
    await this.authorization.requireModule(principal, organizationId, 'CRM', 'parties:read');
    const party = await this.prisma.businessParty.findFirst({ where: { id: partyId, organizationId }, select: this.select });
    if (!party) throw new NotFoundException();
    return this.serialize(party);
  }

  async create(principal: AuthPrincipal, organizationId: string, input: CreatePartyDto): Promise<unknown> {
    await this.authorization.requireModule(principal, organizationId, 'CRM', 'parties:write');
    const id = randomUUID();
    const eventContext = currentEventContext();
    const context = eventContext?.requestId ? { requestId: eventContext.requestId, correlationId: eventContext.correlationId } : createRequestContext();
    return this.prisma.$transaction(async (tx) => {
      const party = await tx.businessParty.create({ data: { id, organizationId, type: input.type, displayName: input.displayName.trim(), ...(input.email !== undefined ? { email: input.email.trim().toLowerCase() } : {}), ...(input.phone !== undefined ? { phone: input.phone.trim() } : {}), ...(input.taxId !== undefined ? { taxId: input.taxId.trim() } : {}), ...(input.notes !== undefined ? { notes: input.notes.trim() } : {}) }, select: this.select });
      await this.recordMutation(tx, 'BUSINESS_PARTY_CREATED', 'business_party.created', principal, organizationId, id, context, { type: party.type, displayName: party.displayName });
      return this.serialize(party);
    }).catch((error: unknown) => {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('Business party conflicts with an existing record');
      throw error;
    });
  }

  async update(principal: AuthPrincipal, organizationId: string, partyId: string, input: UpdatePartyDto): Promise<unknown> {
    await this.authorization.requireModule(principal, organizationId, 'CRM', 'parties:write');
    if (Object.keys(input).length === 0) throw new BadRequestException('At least one party field is required');
    const eventContext = currentEventContext();
    const context = eventContext?.requestId ? { requestId: eventContext.requestId, correlationId: eventContext.correlationId } : createRequestContext();
    const current = await this.prisma.businessParty.findFirst({ where: { id: partyId, organizationId }, select: { id: true } });
    if (!current) throw new NotFoundException();
    return this.prisma.$transaction(async (tx) => {
      const party = await tx.businessParty.update({ where: { id: partyId }, data: { ...(input.type ? { type: input.type } : {}), ...(input.displayName !== undefined ? { displayName: input.displayName.trim() } : {}), ...(input.email !== undefined ? { email: input.email.trim().toLowerCase() } : {}), ...(input.phone !== undefined ? { phone: input.phone.trim() } : {}), ...(input.taxId !== undefined ? { taxId: input.taxId.trim() } : {}), ...(input.notes !== undefined ? { notes: input.notes.trim() } : {}) }, select: this.select });
      await this.recordMutation(tx, 'BUSINESS_PARTY_UPDATED', 'business_party.updated', principal, organizationId, partyId, context, { fields: Object.keys(input) });
      return this.serialize(party);
    });
  }

  async setActive(principal: AuthPrincipal, organizationId: string, partyId: string, active: boolean): Promise<unknown> {
    await this.authorization.requireModule(principal, organizationId, 'CRM', 'parties:write');
    const eventContext = currentEventContext();
    const context = eventContext?.requestId ? { requestId: eventContext.requestId, correlationId: eventContext.correlationId } : createRequestContext();
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.businessParty.findFirst({ where: { id: partyId, organizationId }, select: this.select });
      if (!current) throw new NotFoundException();
      if (current.active === active) return this.serialize(current);
      const party = await tx.businessParty.update({ where: { id: partyId }, data: { active }, select: this.select });
      await this.recordMutation(tx, 'BUSINESS_PARTY_STATUS_CHANGED', 'business_party.status_changed', principal, organizationId, partyId, context, { active });
      return this.serialize(party);
    });
  }

  private async recordMutation(tx: Prisma.TransactionClient, action: AuditAction, eventType: string, principal: AuthPrincipal, organizationId: string, partyId: string, context: { requestId: string; correlationId: string }, payload: Record<string, unknown>): Promise<void> {
    await tx.auditEvent.create({ data: { id: randomUUID(), action, actorUserId: principal.userId, organizationId, targetType: 'BusinessParty', targetId: partyId, requestId: context.requestId, correlationId: context.correlationId, metadataJson: payload as Prisma.InputJsonValue } });
    await this.outbox.enqueue(tx, createDomainEvent({ eventType, eventVersion: 1, occurredAt: new Date().toISOString(), actor: { type: 'USER', id: principal.userId }, aggregate: { type: 'BusinessParty', id: partyId }, organizationId, correlationId: context.correlationId, requestId: context.requestId, dataClassification: 'CONFIDENTIAL', purpose: 'business-party-referential', payload }));
  }

  private readonly select = { id: true, organizationId: true, type: true, displayName: true, email: true, phone: true, taxId: true, notes: true, active: true, createdAt: true, updatedAt: true } as const;

  private serialize(party: { id: string; organizationId: string; type: string; displayName: string; email: string | null; phone: string | null; taxId: string | null; notes: string | null; active: boolean; createdAt: Date; updatedAt: Date }): unknown {
    return { ...party, createdAt: party.createdAt.toISOString(), updatedAt: party.updatedAt.toISOString() };
  }

  private encodeCursor(cursor: PartyCursor): string { return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url'); }

  private decodeCursor(value: string): PartyCursor {
    try {
      const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Partial<PartyCursor>;
      if (typeof parsed.createdAt !== 'string' || typeof parsed.id !== 'string' || Number.isNaN(Date.parse(parsed.createdAt))) throw new Error('invalid');
      return { createdAt: parsed.createdAt, id: parsed.id };
    } catch {
      throw new BadRequestException('Cursor is invalid');
    }
  }
}
