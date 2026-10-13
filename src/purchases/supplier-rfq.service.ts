import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type AuditAction, type SupplierRFQStatus } from '@prisma/client';
import { PrismaService } from '../database/prisma.service.js';
import { createDomainEvent } from '../events/domain-event.factory.js';
import { createRequestContext, currentEventContext } from '../events/event-context.js';
import { PrismaOutboxWriter } from '../events/prisma-outbox.writer.js';
import type { AuthPrincipal } from '../auth/auth.types.js';
import { AuthorizationService } from '../tenancy/authorization.service.js';
import { NumberingService } from '../sales/numbering.service.js';
import { SalesDocumentType } from '../sales/sales.types.js';
import type { CreateSupplierRFQDto, CreateSupplierRFQLineDto, CreateSupplierRFQRecipientDto, SupplierRfqListQuery, UpdateSupplierRFQDto } from './supplier-rfq.dto.js';

type RfqCursor = { createdAt: string; id: string };

const rfqSelect = {
  id: true,
  organizationId: true,
  establishmentId: true,
  number: true,
  status: true,
  title: true,
  neededBy: true,
  currency: true,
  notes: true,
  createdAt: true,
  updatedAt: true,
  lines: { orderBy: { lineIndex: 'asc' }, select: { id: true, lineIndex: true, itemId: true, itemNameSnapshot: true, itemSkuSnapshot: true, descriptionSnapshot: true, unitSnapshot: true, quantity: true, requestedBy: true } },
  recipients: { orderBy: { createdAt: 'asc' }, select: { id: true, recipientKind: true, localPartyId: true, networkOrganizationId: true, displayNameSnapshot: true, emailSnapshot: true, phoneSnapshot: true, status: true, sentAt: true, respondedAt: true, createdAt: true, updatedAt: true } },
} as const;

type RfqWithDetails = Prisma.SupplierRFQGetPayload<{ select: typeof rfqSelect }>;
type PreparedLine = { id: string; organizationId: string; lineIndex: number; itemId: string | null; itemNameSnapshot: string; itemSkuSnapshot: string | null; descriptionSnapshot: string | null; unitSnapshot: string; quantity: string; requestedBy: string | null };
type PreparedRecipient = { id: string; organizationId: string; recipientKind: 'LOCAL_PARTY' | 'NETWORK_ORGANIZATION'; localPartyId: string | null; networkOrganizationId: string | null; displayNameSnapshot: string; emailSnapshot: string | null; phoneSnapshot: string | null };

@Injectable()
export class SupplierRFQService {
  private readonly numbering = new NumberingService();

  constructor(private readonly prisma: PrismaService, private readonly authorization: AuthorizationService, private readonly outbox: PrismaOutboxWriter) {}

  async list(principal: AuthPrincipal, organizationId: string, query: SupplierRfqListQuery): Promise<unknown> {
    const context = await this.authorization.requireModule(principal, organizationId, 'PURCHASES', 'purchases:rfqs:read');
    if (query.establishmentId) await this.authorization.assertEstablishment(context, query.establishmentId);
    const establishmentIds = query.establishmentId ? [query.establishmentId] : context.scopeMode === 'SELECTED_ESTABLISHMENTS' ? Array.from(context.establishmentIds) : undefined;
    const cursor = query.cursor ? this.decodeCursor(query.cursor) : undefined;
    const limit = query.limit ?? 20;
    const rows = await this.prisma.supplierRFQ.findMany({ where: { organizationId, ...(establishmentIds ? { establishmentId: { in: establishmentIds } } : {}), ...(cursor ? { OR: [{ createdAt: { gt: new Date(cursor.createdAt) } }, { createdAt: new Date(cursor.createdAt), id: { gt: cursor.id } }] } : {}) }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: limit + 1, select: rfqSelect });
    const items = rows.slice(0, limit).map((row) => this.serialize(row));
    const next = rows.length > limit ? rows[limit - 1] : undefined;
    return { items, nextCursor: next ? this.encodeCursor({ createdAt: next.createdAt.toISOString(), id: next.id }) : null };
  }

  async get(principal: AuthPrincipal, organizationId: string, rfqId: string): Promise<unknown> {
    const context = await this.authorization.requireModule(principal, organizationId, 'PURCHASES', 'purchases:rfqs:read');
    const rfq = await this.prisma.supplierRFQ.findFirst({ where: { id: rfqId, organizationId }, select: rfqSelect });
    if (!rfq) throw new NotFoundException('Supplier RFQ not found');
    await this.authorization.assertEstablishment(context, rfq.establishmentId);
    return this.serialize(rfq);
  }

  async create(principal: AuthPrincipal, organizationId: string, input: CreateSupplierRFQDto, rawIdempotencyKey?: string): Promise<unknown> {
    const context = await this.authorization.requireModule(principal, organizationId, 'PURCHASES', 'purchases:rfqs:write');
    await this.authorization.assertEstablishment(context, input.establishmentId);
    const idempotencyKey = this.requireIdempotencyKey(rawIdempotencyKey);
    const currency = input.currency.toUpperCase();
    const organization = await this.prisma.organization.findFirst({ where: { id: organizationId, status: 'ACTIVE' }, select: { defaultCurrency: true } });
    if (!organization) throw new NotFoundException('Organization not found');
    if (organization.defaultCurrency !== currency) throw new BadRequestException('Supplier RFQ currency must match the organization default currency');
    const eventContext = this.eventContext();
    try {
      return await this.prisma.$transaction(async (tx) => {
        const existing = await tx.supplierRFQ.findFirst({ where: { organizationId, idempotencyKey }, select: rfqSelect });
        if (existing) return this.serialize(existing);
        const lines = await this.prepareLines(tx, organizationId, input.lines);
        const recipients = await this.prepareRecipients(tx, organizationId, input.recipients);
        const id = randomUUID();
        const number = await this.numbering.allocate(SalesDocumentType.SUPPLIER_RFQ, organizationId, new Date().getUTCFullYear(), tx);
        await tx.supplierRFQ.create({ data: { id, organizationId, establishmentId: input.establishmentId, number, title: input.title.trim(), neededBy: this.dateOnly(this.requestedDate(input)), currency, notes: input.notes?.trim() || null, idempotencyKey, createdByUserId: principal.userId } });
        await tx.supplierRFQLine.createMany({ data: lines.map((line, index) => ({ ...line, id: randomUUID(), lineIndex: index + 1, supplierRfqId: id })) });
        await tx.supplierRFQRecipient.createMany({ data: recipients.map((recipient) => ({ ...recipient, id: randomUUID(), supplierRfqId: id })) });
        const rfq = await tx.supplierRFQ.findFirstOrThrow({ where: { id, organizationId }, select: rfqSelect });
        await this.recordMutation(tx, 'SUPPLIER_RFQ_CREATED', 'purchases.supplier_rfq.created.v1', principal, organizationId, rfq.establishmentId, id, eventContext, { number: rfq.number, status: rfq.status, recipientCount: rfq.recipients.length, lineCount: rfq.lines.length });
        return this.serialize(rfq);
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('Supplier RFQ conflicts with an existing record');
      throw error;
    }
  }

  async update(principal: AuthPrincipal, organizationId: string, rfqId: string, input: UpdateSupplierRFQDto, rawIdempotencyKey?: string): Promise<unknown> {
    const context = await this.authorization.requireModule(principal, organizationId, 'PURCHASES', 'purchases:rfqs:write');
    const current = await this.prisma.supplierRFQ.findFirst({ where: { id: rfqId, organizationId }, select: { id: true, status: true, establishmentId: true, currency: true, idempotencyKey: true } });
    if (!current) throw new NotFoundException('Supplier RFQ not found');
    await this.authorization.assertEstablishment(context, current.establishmentId);
    if (Object.keys(input).length === 0) throw new BadRequestException('At least one Supplier RFQ field is required');
    if (current.status !== 'DRAFT') throw new ConflictException(`Supplier RFQ cannot be edited from ${current.status}`);
    const idempotencyKey = this.requireIdempotencyKey(rawIdempotencyKey);
    if (current.idempotencyKey === idempotencyKey) return this.get(principal, organizationId, rfqId);
    const eventContext = this.eventContext();
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`SELECT id FROM supplier_rfqs WHERE id = ${rfqId}::uuid AND organization_id = ${organizationId}::uuid FOR UPDATE`);
      const locked = await tx.supplierRFQ.findFirst({ where: { id: rfqId, organizationId }, select: { id: true, status: true, currency: true, establishmentId: true, idempotencyKey: true } });
      if (!locked) throw new NotFoundException('Supplier RFQ not found');
      if (locked.status !== 'DRAFT') throw new ConflictException(`Supplier RFQ cannot be edited from ${locked.status}`);
      const lines = input.lines ? await this.prepareLines(tx, organizationId, input.lines) : undefined;
      const recipients = input.recipients ? await this.prepareRecipients(tx, organizationId, input.recipients) : undefined;
      await tx.supplierRFQ.update({ where: { id: rfqId }, data: { ...(input.title !== undefined ? { title: input.title.trim() } : {}), ...(this.hasDateInput(input) ? { neededBy: this.optionalDate(this.requestedDate(input)) } : {}), ...(input.notes !== undefined ? { notes: input.notes?.trim() || null } : {}), idempotencyKey } });
      if (lines) {
        await tx.supplierRFQLine.deleteMany({ where: { supplierRfqId: rfqId, organizationId } });
        await tx.supplierRFQLine.createMany({ data: lines.map((line, index) => ({ ...line, id: randomUUID(), lineIndex: index + 1, supplierRfqId: rfqId })) });
      }
      if (recipients) {
        await tx.supplierRFQRecipient.deleteMany({ where: { supplierRfqId: rfqId, organizationId } });
        await tx.supplierRFQRecipient.createMany({ data: recipients.map((recipient) => ({ ...recipient, id: randomUUID(), supplierRfqId: rfqId })) });
      }
      const updated = await tx.supplierRFQ.findFirstOrThrow({ where: { id: rfqId, organizationId }, select: rfqSelect });
      await this.recordMutation(tx, 'SUPPLIER_RFQ_UPDATED', 'purchases.supplier_rfq.updated.v1', principal, organizationId, updated.establishmentId, rfqId, eventContext, { fields: Object.keys(input), status: updated.status });
      return this.serialize(updated);
    });
  }

  async transition(principal: AuthPrincipal, organizationId: string, rfqId: string, target: SupplierRFQStatus, rawIdempotencyKey?: string): Promise<unknown> {
    const context = await this.authorization.requireModule(principal, organizationId, 'PURCHASES', 'purchases:rfqs:write');
    const current = await this.prisma.supplierRFQ.findFirst({ where: { id: rfqId, organizationId }, select: { status: true, establishmentId: true } });
    if (!current) throw new NotFoundException('Supplier RFQ not found');
    await this.authorization.assertEstablishment(context, current.establishmentId);
    const idempotencyKey = this.requireIdempotencyKey(rawIdempotencyKey);
    if (current.status === target) return this.get(principal, organizationId, rfqId);
    if (!this.isLegalTransition(current.status, target)) throw new ConflictException(`Supplier RFQ cannot transition from ${current.status} to ${target}`);
    const eventContext = this.eventContext();
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`SELECT id FROM supplier_rfqs WHERE id = ${rfqId}::uuid AND organization_id = ${organizationId}::uuid FOR UPDATE`);
      const locked = await tx.supplierRFQ.findFirst({ where: { id: rfqId, organizationId }, select: { status: true, establishmentId: true, number: true } });
      if (!locked) throw new NotFoundException('Supplier RFQ not found');
      if (locked.status === target) return this.get(principal, organizationId, rfqId);
      if (!this.isLegalTransition(locked.status, target)) throw new ConflictException(`Supplier RFQ cannot transition from ${locked.status} to ${target}`);
      const pending = target === 'SENT' ? await tx.supplierRFQRecipient.findMany({ where: { supplierRfqId: rfqId, organizationId, status: 'PENDING' }, select: { id: true } }) : [];
      await tx.supplierRFQ.update({ where: { id: rfqId }, data: { status: target, idempotencyKey } });
      if (target === 'SENT' && pending.length > 0) await tx.supplierRFQRecipient.updateMany({ where: { supplierRfqId: rfqId, organizationId, status: 'PENDING' }, data: { status: 'SENT', sentAt: new Date() } });
      const updated = await tx.supplierRFQ.findFirstOrThrow({ where: { id: rfqId, organizationId }, select: rfqSelect });
      await this.recordMutation(tx, 'SUPPLIER_RFQ_STATUS_CHANGED', 'purchases.supplier_rfq.status_changed.v1', principal, organizationId, updated.establishmentId, rfqId, eventContext, { previousStatus: locked.status, status: updated.status, number: locked.number });
      if (target === 'SENT') for (const recipient of pending) await this.recordMutation(tx, 'SUPPLIER_RFQ_STATUS_CHANGED', 'purchases.supplier_rfq.recipient_sent.v1', principal, organizationId, updated.establishmentId, rfqId, eventContext, { recipientId: recipient.id, status: 'SENT' });
      return this.serialize(updated);
    });
  }

  private async prepareLines(tx: Prisma.TransactionClient, organizationId: string, inputLines: CreateSupplierRFQLineDto[]): Promise<PreparedLine[]> {
    return Promise.all(inputLines.map(async (line, index) => {
      const quantity = new Prisma.Decimal(line.quantity);
      if (quantity.lte(0)) throw new BadRequestException('RFQ quantities must be greater than zero');
      const item = line.itemId ? await tx.item.findFirst({ where: { id: line.itemId, organizationId, active: true }, select: { id: true, name: true, sku: true, description: true, unit: true } }) : null;
      if (line.itemId && !item) throw new NotFoundException('Active catalog item not found');
      return { id: randomUUID(), organizationId, lineIndex: index + 1, itemId: item?.id ?? null, itemNameSnapshot: item?.name ?? line.descriptionSnapshot.trim(), itemSkuSnapshot: item?.sku ?? null, descriptionSnapshot: item?.description?.trim() || line.descriptionSnapshot.trim(), unitSnapshot: item?.unit ?? line.unitSnapshot.trim(), quantity: quantity.toFixed(6), requestedBy: line.requestedBy ?? null };
    }));
  }

  private async prepareRecipients(tx: Prisma.TransactionClient, organizationId: string, inputs: CreateSupplierRFQRecipientDto[]): Promise<PreparedRecipient[]> {
    const keys = new Set<string>();
    const recipients: PreparedRecipient[] = [];
    for (const input of inputs) {
      const hasLocal = Boolean(input.localPartyId);
      const hasNetwork = Boolean(input.networkOrganizationId);
      if (hasLocal === hasNetwork) throw new ConflictException('Exactly one RFQ recipient target is required');
      const key = hasLocal ? `party:${input.localPartyId}` : `organization:${input.networkOrganizationId}`;
      if (keys.has(key)) throw new ConflictException('Duplicate RFQ recipient');
      keys.add(key);
      if (hasLocal) {
        const localPartyId = input.localPartyId!;
        const party = await tx.businessParty.findFirst({ where: { id: localPartyId, organizationId, active: true }, select: { id: true, type: true, displayName: true, email: true, phone: true } });
        if (!party || !['SUPPLIER', 'BOTH'].includes(party.type)) throw new ConflictException('Local RFQ recipient must be an active supplier party');
        recipients.push({ id: randomUUID(), organizationId, recipientKind: 'LOCAL_PARTY', localPartyId: party.id, networkOrganizationId: null, displayNameSnapshot: party.displayName, emailSnapshot: party.email, phoneSnapshot: party.phone });
        continue;
      }
      const networkOrganizationId = input.networkOrganizationId!;
      if (organizationId === networkOrganizationId) throw new ConflictException('An organization cannot target itself with an RFQ');
      const target = await tx.organization.findFirst({ where: { id: networkOrganizationId, status: 'ACTIVE', networkProfile: { isPublic: true } }, select: { id: true, networkProfile: { select: { displayName: true } } } });
      if (!target?.networkProfile) throw new ConflictException('Network RFQ recipient must have an active public profile');
      const connection = await tx.connectionRequest.findFirst({ where: { status: 'ACCEPTED', OR: [{ sourceOrganizationId: organizationId, targetOrganizationId: target.id }, { sourceOrganizationId: target.id, targetOrganizationId: organizationId }] }, select: { id: true } });
      if (!connection) throw new ConflictException('An accepted Network connection is required before sending an RFQ');
      recipients.push({ id: randomUUID(), organizationId, recipientKind: 'NETWORK_ORGANIZATION', localPartyId: null, networkOrganizationId: target.id, displayNameSnapshot: target.networkProfile.displayName, emailSnapshot: null, phoneSnapshot: null });
    }
    return recipients;
  }

  private async recordMutation(tx: Prisma.TransactionClient, action: AuditAction, eventType: string, principal: AuthPrincipal, organizationId: string, establishmentId: string, rfqId: string, context: { requestId: string; correlationId: string }, payload: Record<string, unknown>): Promise<void> {
    await tx.auditEvent.create({ data: { id: randomUUID(), action, actorUserId: principal.userId, organizationId, establishmentId, targetType: 'SupplierRFQ', targetId: rfqId, requestId: context.requestId, correlationId: context.correlationId, metadataJson: payload as Prisma.InputJsonValue } });
    await this.outbox.enqueue(tx, createDomainEvent({ eventType, eventVersion: 1, occurredAt: new Date().toISOString(), actor: { type: 'USER', id: principal.userId }, aggregate: { type: 'SupplierRFQ', id: rfqId }, organizationId, establishmentId, correlationId: context.correlationId, requestId: context.requestId, dataClassification: 'CONFIDENTIAL', purpose: 'purchases-supplier-rfq', payload }));
  }

  private serialize(rfq: RfqWithDetails): unknown {
    const date = rfq.neededBy?.toISOString().slice(0, 10) ?? null;
    return { id: rfq.id, organizationId: rfq.organizationId, establishmentId: rfq.establishmentId, number: rfq.number, status: rfq.status, title: rfq.title, neededBy: date, needDate: date, currency: rfq.currency.trim(), notes: rfq.notes, lines: rfq.lines.map((line) => ({ id: line.id, lineIndex: line.lineIndex, itemId: line.itemId, itemNameSnapshot: line.itemNameSnapshot, skuSnapshot: line.itemSkuSnapshot, descriptionSnapshot: line.descriptionSnapshot ?? line.itemNameSnapshot, unitSnapshot: line.unitSnapshot, quantity: line.quantity.toFixed(6), requestedBy: line.requestedBy })), recipients: rfq.recipients.map((recipient) => ({ id: recipient.id, localPartyId: recipient.localPartyId, networkOrganizationId: recipient.networkOrganizationId, supplierKind: recipient.recipientKind, displayName: recipient.displayNameSnapshot, email: recipient.emailSnapshot, phone: recipient.phoneSnapshot, status: recipient.status, sentAt: recipient.sentAt?.toISOString() ?? null, respondedAt: recipient.respondedAt?.toISOString() ?? null, createdAt: recipient.createdAt.toISOString(), updatedAt: recipient.updatedAt.toISOString() })), createdAt: rfq.createdAt.toISOString(), updatedAt: rfq.updatedAt.toISOString() };
  }

  private isLegalTransition(current: SupplierRFQStatus, target: SupplierRFQStatus): boolean { return (current === 'DRAFT' && (target === 'SENT' || target === 'CANCELLED')) || (current === 'SENT' && (target === 'CLOSED' || target === 'CANCELLED')); }
  private requireIdempotencyKey(value?: string): string { if (!value || !value.trim() || value.length > 200 || /[\r\n]/.test(value)) throw new BadRequestException('Idempotency-Key is required and invalid'); return value.trim(); }
  private requestedDate(input: { neededBy?: string | null; needDate?: string | null }): string | null { if (input.neededBy !== undefined && input.needDate !== undefined && input.neededBy !== input.needDate) throw new BadRequestException('neededBy and needDate must match'); return input.neededBy ?? input.needDate ?? null; }
  private hasDateInput(input: { neededBy?: string | null; needDate?: string | null }): boolean { return input.neededBy !== undefined || input.needDate !== undefined; }
  private dateOnly(value: string | null): Date | null { if (value === null) return null; if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00.000Z`))) throw new BadRequestException('Date must use YYYY-MM-DD'); return new Date(`${value}T00:00:00.000Z`); }
  private optionalDate(value: string | null): Date | null { return this.dateOnly(value); }
  private eventContext(): { requestId: string; correlationId: string } { const context = currentEventContext(); return context?.requestId ? { requestId: context.requestId, correlationId: context.correlationId } : createRequestContext(); }
  private encodeCursor(cursor: RfqCursor): string { return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url'); }
  private decodeCursor(value: string): RfqCursor { try { const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Partial<RfqCursor>; if (typeof parsed.createdAt !== 'string' || typeof parsed.id !== 'string' || Number.isNaN(Date.parse(parsed.createdAt))) throw new Error('invalid'); return { createdAt: parsed.createdAt, id: parsed.id }; } catch { throw new BadRequestException('Cursor is invalid'); } }
}
