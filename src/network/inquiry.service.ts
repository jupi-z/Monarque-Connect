import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type AuditAction, type NetworkInquiryStatus } from '@prisma/client';
import { PrismaService } from '../database/prisma.service.js';
import { createDomainEvent } from '../events/domain-event.factory.js';
import { createRequestContext, currentEventContext } from '../events/event-context.js';
import { PrismaOutboxWriter } from '../events/prisma-outbox.writer.js';
import type { AuthPrincipal } from '../auth/auth.types.js';
import { AuthorizationService } from '../tenancy/authorization.service.js';
import { EffectiveEntitlementsService } from '../entitlements/effective-entitlements.service.js';
import type { ConvertNetworkInquiryDto, CreateNetworkInquiryDto, NetworkInquiryListQuery } from './inquiry.dto.js';

type InquiryCursor = { createdAt: string; id: string };

@Injectable()
export class NetworkInquiryService {
  constructor(private readonly prisma: PrismaService, private readonly authorization: AuthorizationService, private readonly outbox: PrismaOutboxWriter, private readonly entitlements: EffectiveEntitlementsService) {}

  async create(principal: AuthPrincipal, organizationId: string, targetOrganizationId: string, input: CreateNetworkInquiryDto): Promise<unknown> {
    await this.authorization.requireModule(principal, organizationId, 'NETWORK_INQUIRIES', 'network:inquiries:write');
    if (organizationId === targetOrganizationId) throw new ConflictException('An organization cannot inquire itself');
    const target = await this.prisma.organization.findFirst({ where: { id: targetOrganizationId, status: 'ACTIVE', networkProfile: { isPublic: true } }, select: { id: true } });
    if (!target) throw new NotFoundException('Target organization not found');
    const targetCapabilities = (await this.entitlements.resolve(target.id)).modules.find((module) => module.code === 'NETWORK_INQUIRIES');
    if (!targetCapabilities?.allowed) throw new ConflictException('Target organization cannot receive inquiries');
    const connection = await this.prisma.connectionRequest.findFirst({ where: { status: 'ACCEPTED', OR: [{ sourceOrganizationId: organizationId, targetOrganizationId }, { sourceOrganizationId: targetOrganizationId, targetOrganizationId: organizationId }] }, select: { id: true } });
    if (!connection) throw new ConflictException('An accepted connection is required before sending an inquiry');
    const context = this.context();
    return this.prisma.$transaction(async (tx) => {
      const inquiry = await tx.networkInquiry.create({ data: { id: randomUUID(), sourceOrganizationId: organizationId, targetOrganizationId, subject: input.subject.trim(), message: input.message.trim(), ...(input.requestedPartyType ? { requestedPartyType: input.requestedPartyType } : {}) }, select: this.select });
      await this.recordMutation(tx, 'NETWORK_INQUIRY_CREATED', 'network.inquiry.created', principal, organizationId, inquiry.id, context, { sourceOrganizationId: organizationId, targetOrganizationId, status: inquiry.status, requestedPartyType: inquiry.requestedPartyType });
      return this.serialize(inquiry);
    });
  }

  async list(principal: AuthPrincipal, organizationId: string, query: NetworkInquiryListQuery): Promise<unknown> {
    await this.authorization.requireModule(principal, organizationId, 'NETWORK_INQUIRIES', 'network:inquiries:read');
    const limit = query.limit ?? 20;
    const cursor = query.cursor ? this.decodeCursor(query.cursor) : undefined;
    const rows = await this.prisma.networkInquiry.findMany({
      where: { AND: [{ OR: [{ sourceOrganizationId: organizationId }, { targetOrganizationId: organizationId }] }, ...(query.status ? [{ status: query.status }] : []), ...(cursor ? [{ OR: [{ createdAt: { gt: new Date(cursor.createdAt) } }, { createdAt: new Date(cursor.createdAt), id: { gt: cursor.id } }] }] : [])] },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: limit + 1,
      select: this.select,
    });
    const items = rows.slice(0, limit).map((inquiry) => this.serialize(inquiry));
    const next = rows.length > limit ? rows[limit - 1] : undefined;
    return { items, nextCursor: next ? this.encodeCursor({ createdAt: next.createdAt.toISOString(), id: next.id }) : null };
  }

  async transition(principal: AuthPrincipal, organizationId: string, inquiryId: string, status: 'QUALIFIED' | 'DISMISSED'): Promise<unknown> {
    await this.authorization.requireModule(principal, organizationId, 'NETWORK_INQUIRIES', 'network:inquiries:write');
    const current = await this.prisma.networkInquiry.findUnique({ where: { id: inquiryId }, select: this.select });
    if (!current) throw new NotFoundException('Network inquiry not found');
    if (current.sourceOrganizationId !== organizationId && current.targetOrganizationId !== organizationId) throw new ForbiddenException('Network inquiry access denied');
    if (current.status === status) return this.serialize(current);
    if ((current.status !== 'NEW' && current.status !== 'QUALIFIED') || (current.status === 'QUALIFIED' && status === 'QUALIFIED')) throw new ConflictException('Network inquiry cannot transition from its current status');
    const context = this.context();
    return this.prisma.$transaction(async (tx) => {
      const changed = await tx.networkInquiry.updateMany({ where: { id: inquiryId, status: current.status, OR: [{ sourceOrganizationId: organizationId }, { targetOrganizationId: organizationId }] }, data: { status } });
      if (changed.count === 0) {
        const latest = await tx.networkInquiry.findUnique({ where: { id: inquiryId }, select: this.select });
        if (!latest) throw new NotFoundException('Network inquiry not found');
        if (latest.status === status) return this.serialize(latest);
        throw new ConflictException('Network inquiry was changed concurrently');
      }
      const updated = await tx.networkInquiry.findUniqueOrThrow({ where: { id: inquiryId }, select: this.select });
      await this.recordMutation(tx, 'NETWORK_INQUIRY_STATUS_CHANGED', 'network.inquiry.status_changed', principal, organizationId, inquiryId, context, { previousStatus: current.status, status: updated.status });
      return this.serialize(updated);
    });
  }

  async convert(principal: AuthPrincipal, organizationId: string, inquiryId: string, input: ConvertNetworkInquiryDto): Promise<unknown> {
    await this.authorization.requireModule(principal, organizationId, 'NETWORK_INQUIRIES', 'network:inquiries:write');
    const crmContext = await this.authorization.requireModule(principal, organizationId, 'CRM', 'crm:write');
    if (input.targetType === 'OPPORTUNITY' && !input.establishmentId) throw new BadRequestException('Establishment is required for an opportunity');
    if (input.establishmentId) await this.authorization.assertEstablishment(crmContext, input.establishmentId);
    const context = this.context();
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`SELECT id FROM network_inquiries WHERE id = ${inquiryId}::uuid FOR UPDATE`);
      const inquiry = await tx.networkInquiry.findUnique({ where: { id: inquiryId }, select: this.select });
      if (!inquiry) throw new NotFoundException('Network inquiry not found');
      if (inquiry.targetOrganizationId !== organizationId) throw new ForbiddenException('Only the target organization can convert an inquiry');
      if (inquiry.status === 'CONVERTED') {
        const targetId = input.targetType === 'LEAD' ? inquiry.convertedLead?.id : inquiry.convertedOpportunity?.id;
        if (targetId) return { inquiryId, targetType: input.targetType, targetId };
        throw new ConflictException('Network inquiry was already converted to another CRM target');
      }
      if (inquiry.status === 'DISMISSED') throw new ConflictException('Dismissed inquiries cannot be converted');
      if (input.targetType === 'LEAD') {
        const lead = await tx.lead.create({ data: { id: randomUUID(), organizationId, networkInquiryId: inquiryId, source: 'NETWORK_INQUIRY', displayName: inquiry.subject, notes: inquiry.message }, select: { id: true } });
        await this.recordMutation(tx, 'LEAD_CREATED', 'crm.lead.created', principal, organizationId, lead.id, context, { status: 'NEW', source: 'NETWORK_INQUIRY' });
        await this.recordMutation(tx, 'NETWORK_INQUIRY_CONVERTED', 'network.inquiry.converted', principal, organizationId, inquiryId, context, { targetType: 'LEAD', targetId: lead.id });
        await tx.networkInquiry.update({ where: { id: inquiryId }, data: { status: 'CONVERTED' } });
        return { inquiryId, targetType: 'LEAD', targetId: lead.id };
      }
      const opportunity = await tx.opportunity.create({ data: { id: randomUUID(), organizationId, establishmentId: input.establishmentId!, networkInquiryId: inquiryId, source: 'NETWORK_INQUIRY', name: inquiry.subject }, select: { id: true } });
      await this.recordMutation(tx, 'OPPORTUNITY_CREATED', 'crm.opportunity.created', principal, organizationId, opportunity.id, context, { status: 'OPEN', source: 'NETWORK_INQUIRY' });
      await this.recordMutation(tx, 'NETWORK_INQUIRY_CONVERTED', 'network.inquiry.converted', principal, organizationId, inquiryId, context, { targetType: 'OPPORTUNITY', targetId: opportunity.id });
      await tx.networkInquiry.update({ where: { id: inquiryId }, data: { status: 'CONVERTED' } });
      return { inquiryId, targetType: 'OPPORTUNITY', targetId: opportunity.id };
    });
  }

  private async recordMutation(tx: Prisma.TransactionClient, action: AuditAction, eventType: string, principal: AuthPrincipal, organizationId: string, targetId: string, context: { requestId: string; correlationId: string }, payload: Record<string, unknown>): Promise<void> {
    await tx.auditEvent.create({ data: { id: randomUUID(), action, actorUserId: principal.userId, organizationId, targetType: action.startsWith('LEAD') ? 'Lead' : action.startsWith('OPPORTUNITY') ? 'Opportunity' : 'NetworkInquiry', targetId, requestId: context.requestId, correlationId: context.correlationId, metadataJson: payload as Prisma.InputJsonValue } });
    await this.outbox.enqueue(tx, createDomainEvent({ eventType, eventVersion: 1, occurredAt: new Date().toISOString(), actor: { type: 'USER', id: principal.userId }, aggregate: { type: action.startsWith('LEAD') ? 'Lead' : action.startsWith('OPPORTUNITY') ? 'Opportunity' : 'NetworkInquiry', id: targetId }, organizationId, correlationId: context.correlationId, requestId: context.requestId, dataClassification: 'CONFIDENTIAL', purpose: 'network-inquiry', payload }));
  }

  private context(): { requestId: string; correlationId: string } { const current = currentEventContext(); return current?.requestId ? { requestId: current.requestId, correlationId: current.correlationId } : createRequestContext(); }
  private encodeCursor(cursor: InquiryCursor): string { return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url'); }
  private decodeCursor(value: string): InquiryCursor { try { const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Partial<InquiryCursor>; if (typeof parsed.createdAt !== 'string' || typeof parsed.id !== 'string' || Number.isNaN(Date.parse(parsed.createdAt))) throw new Error('invalid'); return { createdAt: parsed.createdAt, id: parsed.id }; } catch { throw new BadRequestException('Cursor is invalid'); } }
  private serialize(inquiry: { id: string; sourceOrganizationId: string; targetOrganizationId: string; status: NetworkInquiryStatus; subject: string; message: string; requestedPartyType: string | null; convertedLead?: { id: string } | null; convertedOpportunity?: { id: string } | null; createdAt: Date; updatedAt: Date }): unknown { return { id: inquiry.id, sourceOrganizationId: inquiry.sourceOrganizationId, targetOrganizationId: inquiry.targetOrganizationId, status: inquiry.status, subject: inquiry.subject, message: inquiry.message, requestedPartyType: inquiry.requestedPartyType, convertedLeadId: inquiry.convertedLead?.id ?? null, convertedOpportunityId: inquiry.convertedOpportunity?.id ?? null, createdAt: inquiry.createdAt.toISOString(), updatedAt: inquiry.updatedAt.toISOString() }; }
  private readonly select = { id: true, sourceOrganizationId: true, targetOrganizationId: true, status: true, subject: true, message: true, requestedPartyType: true, createdAt: true, updatedAt: true, convertedLead: { select: { id: true } }, convertedOpportunity: { select: { id: true } } } as const;
}
