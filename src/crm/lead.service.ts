import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type AuditAction, type LeadStatus } from '@prisma/client';
import { PrismaService } from '../database/prisma.service.js';
import { createDomainEvent } from '../events/domain-event.factory.js';
import { createRequestContext, currentEventContext } from '../events/event-context.js';
import { PrismaOutboxWriter } from '../events/prisma-outbox.writer.js';
import type { AuthPrincipal } from '../auth/auth.types.js';
import { AuthorizationService } from '../tenancy/authorization.service.js';
import type { CreateLeadDto, LeadListQuery, TransitionLeadDto } from './lead.dto.js';

type LeadCursor = { createdAt: string; id: string };

@Injectable()
export class LeadService {
  constructor(private readonly prisma: PrismaService, private readonly authorization: AuthorizationService, private readonly outbox: PrismaOutboxWriter) {}

  async list(principal: AuthPrincipal, organizationId: string, query: LeadListQuery): Promise<unknown> {
    await this.authorization.requireModule(principal, organizationId, 'CRM', 'crm:read');
    const limit = query.limit ?? 20;
    const cursor = query.cursor ? this.decodeCursor(query.cursor) : undefined;
    const rows = await this.prisma.lead.findMany({
      where: {
        organizationId,
        active: true,
        ...(query.status ? { status: query.status } : {}),
        ...((query.q || cursor) ? { AND: [ ...(query.q ? [{ OR: [{ displayName: { contains: query.q.trim(), mode: 'insensitive' as const } }, { email: { contains: query.q.trim(), mode: 'insensitive' as const } }] }] : []), ...(cursor ? [{ OR: [{ createdAt: { gt: new Date(cursor.createdAt) } }, { createdAt: new Date(cursor.createdAt), id: { gt: cursor.id } }] }] : []) ] } : {}),
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: limit + 1,
      select: this.select,
    });
    const items = rows.slice(0, limit).map((lead) => this.serialize(lead));
    const next = rows.length > limit ? rows[limit - 1] : undefined;
    return { items, nextCursor: next ? this.encodeCursor({ createdAt: next.createdAt.toISOString(), id: next.id }) : null };
  }

  async create(principal: AuthPrincipal, organizationId: string, input: CreateLeadDto): Promise<unknown> {
    await this.authorization.requireModule(principal, organizationId, 'CRM', 'crm:write');
    if (input.partyId) {
      const party = await this.prisma.businessParty.findFirst({ where: { id: input.partyId, organizationId, active: true }, select: { id: true } });
      if (!party) throw new NotFoundException('Business party not found');
    }
    const id = randomUUID();
    const eventContext = currentEventContext();
    const context = eventContext?.requestId ? { requestId: eventContext.requestId, correlationId: eventContext.correlationId } : createRequestContext();
    return this.prisma.$transaction(async (tx) => {
      const lead = await tx.lead.create({ data: { id, organizationId, ...(input.partyId ? { partyId: input.partyId } : {}), ...(input.networkInquiryId ? { networkInquiryId: input.networkInquiryId } : {}), source: input.networkInquiryId ? 'NETWORK_INQUIRY' : 'DIRECT', displayName: input.displayName.trim(), ...(input.email !== undefined ? { email: input.email.trim().toLowerCase() } : {}), ...(input.phone !== undefined ? { phone: input.phone.trim() } : {}), ...(input.notes !== undefined ? { notes: input.notes.trim() } : {}) }, select: this.select });
      await this.recordMutation(tx, 'LEAD_CREATED', 'crm.lead.created', principal, organizationId, id, context, { status: lead.status, source: lead.source });
      return this.serialize(lead);
    });
  }

  async transition(principal: AuthPrincipal, organizationId: string, leadId: string, input: TransitionLeadDto): Promise<unknown> {
    await this.authorization.requireModule(principal, organizationId, 'CRM', 'crm:write');
    const current = await this.prisma.lead.findFirst({ where: { id: leadId, organizationId }, select: { status: true } });
    if (!current) throw new NotFoundException();
    if (current.status === input.status) return this.getForResponse(organizationId, leadId);
    if (!this.isAllowedTransition(current.status, input.status)) throw new BadRequestException(`Lead cannot transition from ${current.status} to ${input.status}`);
    const eventContext = currentEventContext();
    const context = eventContext?.requestId ? { requestId: eventContext.requestId, correlationId: eventContext.correlationId } : createRequestContext();
    return this.prisma.$transaction(async (tx) => {
      const changed = await tx.lead.updateMany({ where: { id: leadId, organizationId, status: current.status }, data: { status: input.status } });
      if (changed.count === 0) {
        const latest = await tx.lead.findFirst({ where: { id: leadId, organizationId }, select: this.select });
        if (!latest) throw new NotFoundException();
        if (latest.status === input.status) return this.serialize(latest);
        throw new ConflictException('Lead was changed concurrently');
      }
      const lead = await tx.lead.findFirstOrThrow({ where: { id: leadId, organizationId }, select: this.select });
      await this.recordMutation(tx, 'LEAD_STATUS_CHANGED', 'crm.lead.status_changed', principal, organizationId, leadId, context, { previousStatus: current.status, status: lead.status });
      return this.serialize(lead);
    });
  }

  private async recordMutation(tx: Prisma.TransactionClient, action: AuditAction, eventType: string, principal: AuthPrincipal, organizationId: string, leadId: string, context: { requestId: string; correlationId: string }, payload: Record<string, unknown>): Promise<void> {
    await tx.auditEvent.create({ data: { id: randomUUID(), action, actorUserId: principal.userId, organizationId, targetType: 'Lead', targetId: leadId, requestId: context.requestId, correlationId: context.correlationId, metadataJson: payload as Prisma.InputJsonValue } });
    await this.outbox.enqueue(tx, createDomainEvent({ eventType, eventVersion: 1, occurredAt: new Date().toISOString(), actor: { type: 'USER', id: principal.userId }, aggregate: { type: 'Lead', id: leadId }, organizationId, correlationId: context.correlationId, requestId: context.requestId, dataClassification: 'CONFIDENTIAL', purpose: 'crm-lead', payload }));
  }

  private async getForResponse(organizationId: string, leadId: string): Promise<unknown> {
    const lead = await this.prisma.lead.findFirst({ where: { id: leadId, organizationId }, select: this.select });
    if (!lead) throw new NotFoundException();
    return this.serialize(lead);
  }

  private isAllowedTransition(current: LeadStatus, next: string): boolean {
    return (current === 'NEW' && (next === 'QUALIFIED' || next === 'DISMISSED')) || (current === 'QUALIFIED' && (next === 'CONVERTED' || next === 'DISMISSED'));
  }

  private readonly select = { id: true, organizationId: true, partyId: true, networkInquiryId: true, status: true, source: true, displayName: true, email: true, phone: true, notes: true, active: true, createdAt: true, updatedAt: true } as const;

  private serialize(lead: { id: string; organizationId: string; partyId: string | null; networkInquiryId: string | null; status: LeadStatus; source: string; displayName: string; email: string | null; phone: string | null; notes: string | null; active: boolean; createdAt: Date; updatedAt: Date }): unknown {
    return { ...lead, createdAt: lead.createdAt.toISOString(), updatedAt: lead.updatedAt.toISOString() };
  }

  private encodeCursor(cursor: LeadCursor): string { return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url'); }

  private decodeCursor(value: string): LeadCursor {
    try {
      const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Partial<LeadCursor>;
      if (typeof parsed.createdAt !== 'string' || typeof parsed.id !== 'string' || Number.isNaN(Date.parse(parsed.createdAt))) throw new Error('invalid');
      return { createdAt: parsed.createdAt, id: parsed.id };
    } catch {
      throw new BadRequestException('Cursor is invalid');
    }
  }
}
