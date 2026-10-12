import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type AuditAction, type OpportunityStatus } from '@prisma/client';
import { PrismaService } from '../database/prisma.service.js';
import { createDomainEvent } from '../events/domain-event.factory.js';
import { createRequestContext, currentEventContext } from '../events/event-context.js';
import { PrismaOutboxWriter } from '../events/prisma-outbox.writer.js';
import type { AuthPrincipal } from '../auth/auth.types.js';
import { AuthorizationService } from '../tenancy/authorization.service.js';
import type { CreateOpportunityDto, OpportunityListQuery, TransitionOpportunityDto } from './opportunity.dto.js';

type OpportunityCursor = { createdAt: string; id: string };

@Injectable()
export class OpportunityService {
  constructor(private readonly prisma: PrismaService, private readonly authorization: AuthorizationService, private readonly outbox: PrismaOutboxWriter) {}

  async list(principal: AuthPrincipal, organizationId: string, query: OpportunityListQuery): Promise<unknown> {
    const context = await this.authorization.requireModule(principal, organizationId, 'CRM', 'crm:read');
    if (query.establishmentId) await this.authorization.assertEstablishment(context, query.establishmentId);
    const establishmentIds = query.establishmentId ? [query.establishmentId] : context.scopeMode === 'SELECTED_ESTABLISHMENTS' ? Array.from(context.establishmentIds) : undefined;
    const limit = query.limit ?? 20;
    const cursor = query.cursor ? this.decodeCursor(query.cursor) : undefined;
    const rows = await this.prisma.opportunity.findMany({
      where: { organizationId, active: true, ...(establishmentIds ? { establishmentId: { in: establishmentIds } } : {}), ...(query.status ? { status: query.status } : {}), ...(cursor ? { OR: [{ createdAt: { gt: new Date(cursor.createdAt) } }, { createdAt: new Date(cursor.createdAt), id: { gt: cursor.id } }] } : {}) },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: limit + 1,
      select: this.select,
    });
    const items = rows.slice(0, limit).map((opportunity) => this.serialize(opportunity));
    const next = rows.length > limit ? rows[limit - 1] : undefined;
    return { items, nextCursor: next ? this.encodeCursor({ createdAt: next.createdAt.toISOString(), id: next.id }) : null };
  }

  async create(principal: AuthPrincipal, organizationId: string, input: CreateOpportunityDto): Promise<unknown> {
    const context = await this.authorization.requireModule(principal, organizationId, 'CRM', 'crm:write');
    await this.authorization.assertEstablishment(context, input.establishmentId);
    if (input.partyId) {
      const party = await this.prisma.businessParty.findFirst({ where: { id: input.partyId, organizationId, active: true }, select: { id: true } });
      if (!party) throw new NotFoundException('Business party not found');
    }
    if (input.expectedValue !== undefined && !/^\d+(?:\.\d{1,4})?$/.test(input.expectedValue)) throw new BadRequestException('Expected value is invalid');
    if (input.expectedValue !== undefined && !input.currency) throw new BadRequestException('Currency is required with expected value');
    const id = randomUUID();
    const eventContext = currentEventContext();
    const event = eventContext?.requestId ? { requestId: eventContext.requestId, correlationId: eventContext.correlationId } : createRequestContext();
    try {
      return await this.prisma.$transaction(async (tx) => {
        const opportunity = await tx.opportunity.create({ data: { id, organizationId, establishmentId: input.establishmentId, ...(input.partyId ? { partyId: input.partyId } : {}), ...(input.networkInquiryId ? { networkInquiryId: input.networkInquiryId } : {}), source: input.networkInquiryId ? 'NETWORK_INQUIRY' : 'DIRECT', name: input.name.trim(), ...(input.expectedValue !== undefined ? { expectedValue: input.expectedValue } : {}), ...(input.currency ? { currency: input.currency } : {}) }, select: this.select });
        await this.recordMutation(tx, 'OPPORTUNITY_CREATED', 'crm.opportunity.created', principal, organizationId, input.establishmentId, id, event, { status: opportunity.status, source: opportunity.source });
        return this.serialize(opportunity);
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') throw new ConflictException('Opportunity establishment is invalid');
      throw error;
    }
  }

  async transition(principal: AuthPrincipal, organizationId: string, opportunityId: string, input: TransitionOpportunityDto): Promise<unknown> {
    const context = await this.authorization.requireModule(principal, organizationId, 'CRM', 'crm:write');
    const current = await this.prisma.opportunity.findFirst({ where: { id: opportunityId, organizationId }, select: { status: true, establishmentId: true } });
    if (!current) throw new NotFoundException();
    await this.authorization.assertEstablishment(context, current.establishmentId);
    if (current.status === input.status) return this.getForResponse(organizationId, opportunityId);
    if (current.status !== 'OPEN') throw new ConflictException(`Opportunity cannot transition from ${current.status} to ${input.status}`);
    const eventContext = currentEventContext();
    const event = eventContext?.requestId ? { requestId: eventContext.requestId, correlationId: eventContext.correlationId } : createRequestContext();
    return this.prisma.$transaction(async (tx) => {
      const changed = await tx.opportunity.updateMany({ where: { id: opportunityId, organizationId, status: current.status }, data: { status: input.status } });
      if (changed.count === 0) {
        const latest = await tx.opportunity.findFirst({ where: { id: opportunityId, organizationId }, select: this.select });
        if (!latest) throw new NotFoundException();
        if (latest.status === input.status) return this.serialize(latest);
        throw new ConflictException('Opportunity was changed concurrently');
      }
      const opportunity = await tx.opportunity.findFirstOrThrow({ where: { id: opportunityId, organizationId }, select: this.select });
      await this.recordMutation(tx, 'OPPORTUNITY_STATUS_CHANGED', 'crm.opportunity.status_changed', principal, organizationId, opportunity.establishmentId, opportunityId, event, { previousStatus: current.status, status: opportunity.status });
      return this.serialize(opportunity);
    });
  }

  private async recordMutation(tx: Prisma.TransactionClient, action: AuditAction, eventType: string, principal: AuthPrincipal, organizationId: string, establishmentId: string, opportunityId: string, context: { requestId: string; correlationId: string }, payload: Record<string, unknown>): Promise<void> {
    await tx.auditEvent.create({ data: { id: randomUUID(), action, actorUserId: principal.userId, organizationId, establishmentId, targetType: 'Opportunity', targetId: opportunityId, requestId: context.requestId, correlationId: context.correlationId, metadataJson: payload as Prisma.InputJsonValue } });
    await this.outbox.enqueue(tx, createDomainEvent({ eventType, eventVersion: 1, occurredAt: new Date().toISOString(), actor: { type: 'USER', id: principal.userId }, aggregate: { type: 'Opportunity', id: opportunityId }, organizationId, establishmentId, correlationId: context.correlationId, requestId: context.requestId, dataClassification: 'CONFIDENTIAL', purpose: 'crm-opportunity', payload }));
  }

  private async getForResponse(organizationId: string, opportunityId: string): Promise<unknown> {
    const opportunity = await this.prisma.opportunity.findFirst({ where: { id: opportunityId, organizationId }, select: this.select });
    if (!opportunity) throw new NotFoundException();
    return this.serialize(opportunity);
  }

  private readonly select = { id: true, organizationId: true, establishmentId: true, partyId: true, networkInquiryId: true, status: true, source: true, name: true, expectedValue: true, currency: true, active: true, createdAt: true, updatedAt: true } as const;

  private serialize(opportunity: { id: string; organizationId: string; establishmentId: string; partyId: string | null; networkInquiryId: string | null; status: OpportunityStatus; source: string; name: string; expectedValue: Prisma.Decimal | null; currency: string | null; active: boolean; createdAt: Date; updatedAt: Date }): unknown {
    return { ...opportunity, expectedValue: opportunity.expectedValue?.toString() ?? null, createdAt: opportunity.createdAt.toISOString(), updatedAt: opportunity.updatedAt.toISOString() };
  }

  private encodeCursor(cursor: OpportunityCursor): string { return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url'); }

  private decodeCursor(value: string): OpportunityCursor {
    try {
      const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Partial<OpportunityCursor>;
      if (typeof parsed.createdAt !== 'string' || typeof parsed.id !== 'string' || Number.isNaN(Date.parse(parsed.createdAt))) throw new Error('invalid');
      return { createdAt: parsed.createdAt, id: parsed.id };
    } catch {
      throw new BadRequestException('Cursor is invalid');
    }
  }
}
