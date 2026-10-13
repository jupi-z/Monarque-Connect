import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type AuditAction, type QuoteStatus } from '@prisma/client';
import { PrismaService } from '../database/prisma.service.js';
import { createDomainEvent } from '../events/domain-event.factory.js';
import { createRequestContext, currentEventContext } from '../events/event-context.js';
import { PrismaOutboxWriter } from '../events/prisma-outbox.writer.js';
import type { AuthPrincipal } from '../auth/auth.types.js';
import { AuthorizationService } from '../tenancy/authorization.service.js';
import { MoneyCalculator } from './money.js';
import { NumberingService } from './numbering.service.js';
import { SalesDocumentType, type TaxMode } from './sales.types.js';
import type { CreateQuoteDto, CreateQuoteLineDto, QuoteListQuery, UpdateQuoteDto } from './quote.dto.js';

type QuoteCursor = { createdAt: string; id: string };
type PreparedLine = {
  itemId: string | null;
  itemNameSnapshot: string;
  itemSkuSnapshot: string | null;
  descriptionSnapshot: string;
  unitSnapshot: string;
  taxCodeSnapshot: string | null;
  quantity: string;
  unitPrice: string;
  discountAmount: string;
  taxMode: TaxMode;
  taxRate: string;
  netAmount: string;
  taxAmount: string;
  grossAmount: string;
};

const quoteSelect = {
  id: true,
  organizationId: true,
  establishmentId: true,
  number: true,
  status: true,
  partyId: true,
  currency: true,
  validUntil: true,
  totalNet: true,
  totalTax: true,
  totalGross: true,
  createdAt: true,
  updatedAt: true,
  lines: {
    orderBy: { lineIndex: 'asc' },
    select: { lineIndex: true, itemId: true, itemSkuSnapshot: true, descriptionSnapshot: true, unitSnapshot: true, taxCodeSnapshot: true, quantity: true, unitPrice: true, discountAmount: true, taxMode: true, taxRate: true, netAmount: true, taxAmount: true, grossAmount: true },
  },
} as const;

type QuoteWithLines = Prisma.QuoteGetPayload<{ select: typeof quoteSelect }>;

@Injectable()
export class QuoteService {
  private readonly money = new MoneyCalculator();
  private readonly numbering = new NumberingService();

  constructor(private readonly prisma: PrismaService, private readonly authorization: AuthorizationService, private readonly outbox: PrismaOutboxWriter) {}

  async list(principal: AuthPrincipal, organizationId: string, query: QuoteListQuery): Promise<unknown> {
    const context = await this.authorization.requireModule(principal, organizationId, 'SALES', 'sales:quotes:read');
    if (query.establishmentId) await this.authorization.assertEstablishment(context, query.establishmentId);
    const establishmentIds = query.establishmentId ? [query.establishmentId] : context.scopeMode === 'SELECTED_ESTABLISHMENTS' ? Array.from(context.establishmentIds) : undefined;
    const limit = query.limit ?? 20;
    const cursor = query.cursor ? this.decodeCursor(query.cursor) : undefined;
    const rows = await this.prisma.quote.findMany({
      where: { organizationId, ...(establishmentIds ? { establishmentId: { in: establishmentIds } } : {}), ...(cursor ? { OR: [{ createdAt: { gt: new Date(cursor.createdAt) } }, { createdAt: new Date(cursor.createdAt), id: { gt: cursor.id } }] } : {}) },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: limit + 1,
      select: quoteSelect,
    });
    const items = rows.slice(0, limit).map((quote) => this.serialize(quote));
    const next = rows.length > limit ? rows[limit - 1] : undefined;
    return { items, nextCursor: next ? this.encodeCursor({ createdAt: next.createdAt.toISOString(), id: next.id }) : null };
  }

  async get(principal: AuthPrincipal, organizationId: string, quoteId: string): Promise<unknown> {
    const context = await this.authorization.requireModule(principal, organizationId, 'SALES', 'sales:quotes:read');
    const quote = await this.prisma.quote.findFirst({ where: { id: quoteId, organizationId }, select: quoteSelect });
    if (!quote) throw new NotFoundException();
    await this.authorization.assertEstablishment(context, quote.establishmentId);
    return this.serialize(quote);
  }

  async create(principal: AuthPrincipal, organizationId: string, input: CreateQuoteDto, rawIdempotencyKey?: string): Promise<unknown> {
    const context = await this.authorization.requireModule(principal, organizationId, 'SALES', 'sales:quotes:write');
    await this.authorization.assertEstablishment(context, input.establishmentId);
    const idempotencyKey = this.requireIdempotencyKey(rawIdempotencyKey);
    const currency = input.currency.toUpperCase();
    const organization = await this.prisma.organization.findUnique({ where: { id: organizationId }, select: { defaultCurrency: true } });
    if (!organization) throw new NotFoundException();
    if (organization.defaultCurrency !== currency) throw new BadRequestException('Quote currency must match the organization default currency');
    const event = this.eventContext();
    try {
      return await this.prisma.$transaction(async (tx) => {
        const existing = await tx.quote.findFirst({ where: { organizationId, idempotencyKey }, select: quoteSelect });
        if (existing) return this.serialize(existing);
        const party = await tx.businessParty.findFirst({ where: { id: input.partyId, organizationId, active: true }, select: { id: true } });
        if (!party) throw new NotFoundException('Business party not found');
        const lines = await this.prepareLines(tx, organizationId, currency, input.lines);
        const id = randomUUID();
        const number = await this.numbering.allocate(SalesDocumentType.QUOTE, organizationId, new Date().getUTCFullYear(), tx);
        const quote = await tx.quote.create({ data: { id, organizationId, establishmentId: input.establishmentId, number, partyId: input.partyId, currency, validUntil: this.dateOnly(input.validUntil), totalNet: this.sum(lines.map((line) => line.netAmount)), totalTax: this.sum(lines.map((line) => line.taxAmount)), totalGross: this.sum(lines.map((line) => line.grossAmount)), idempotencyKey, createdByUserId: principal.userId, lines: { create: lines.map((line, index) => ({ id: randomUUID(), lineIndex: index + 1, ...line })) } }, select: quoteSelect });
        await this.recordMutation(tx, 'QUOTE_CREATED', 'sales.quote.created', principal, organizationId, quote.establishmentId, id, event, { status: quote.status, number: quote.number, currency: quote.currency, totalGross: quote.totalGross.toFixed(4) });
        return this.serialize(quote);
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const existing = await this.prisma.quote.findFirst({ where: { organizationId, idempotencyKey }, select: quoteSelect });
        if (existing) return this.serialize(existing);
        throw new ConflictException('Quote conflicts with an existing record');
      }
      throw this.normalizeCalculationError(error);
    }
  }

  async update(principal: AuthPrincipal, organizationId: string, quoteId: string, input: UpdateQuoteDto, rawIdempotencyKey?: string): Promise<unknown> {
    const context = await this.authorization.requireModule(principal, organizationId, 'SALES', 'sales:quotes:write');
    const current = await this.prisma.quote.findFirst({ where: { id: quoteId, organizationId }, select: { id: true, status: true, establishmentId: true, currency: true, idempotencyKey: true } });
    if (!current) throw new NotFoundException();
    await this.authorization.assertEstablishment(context, current.establishmentId);
    if (Object.keys(input).length === 0) throw new BadRequestException('At least one quote field is required');
    if (current.status !== 'DRAFT') throw new ConflictException(`Quote cannot be edited from ${current.status}`);
    const idempotencyKey = this.requireIdempotencyKey(rawIdempotencyKey);
    if (current.idempotencyKey === idempotencyKey) return this.getForResponse(organizationId, quoteId);
    const event = this.eventContext();
    try {
      return await this.prisma.$transaction(async (tx) => {
        const lines = input.lines ? await this.prepareLines(tx, organizationId, current.currency, input.lines) : undefined;
        const changed = await tx.quote.updateMany({ where: { id: quoteId, organizationId, status: 'DRAFT' }, data: { ...(input.validUntil !== undefined ? { validUntil: this.dateOnly(input.validUntil) } : {}), ...(lines ? { totalNet: this.sum(lines.map((line) => line.netAmount)), totalTax: this.sum(lines.map((line) => line.taxAmount)), totalGross: this.sum(lines.map((line) => line.grossAmount)) } : {}), idempotencyKey } });
        if (changed.count === 0) {
          const latest = await tx.quote.findFirst({ where: { id: quoteId, organizationId }, select: { status: true, idempotencyKey: true } });
          if (!latest) throw new NotFoundException();
          if (latest.idempotencyKey === idempotencyKey) return this.getForResponse(organizationId, quoteId);
          throw new ConflictException(`Quote cannot be edited from ${latest.status}`);
        }
        if (lines) {
          await tx.quoteLine.deleteMany({ where: { quoteId, organizationId } });
          await tx.quoteLine.createMany({ data: lines.map((line, index) => ({ id: randomUUID(), organizationId, quoteId, lineIndex: index + 1, ...line })) });
        }
        const quote = await tx.quote.findFirstOrThrow({ where: { id: quoteId, organizationId }, select: quoteSelect });
        await this.recordMutation(tx, 'QUOTE_UPDATED', 'sales.quote.updated', principal, organizationId, quote.establishmentId, quoteId, event, { fields: Object.keys(input) });
        return this.serialize(quote);
      });
    } catch (error) {
      throw this.normalizeCalculationError(error);
    }
  }

  async transition(principal: AuthPrincipal, organizationId: string, quoteId: string, target: QuoteStatus, rawIdempotencyKey?: string): Promise<unknown> {
    const context = await this.authorization.requireModule(principal, organizationId, 'SALES', 'sales:quotes:write');
    const current = await this.prisma.quote.findFirst({ where: { id: quoteId, organizationId }, select: { status: true, establishmentId: true, idempotencyKey: true } });
    if (!current) throw new NotFoundException();
    await this.authorization.assertEstablishment(context, current.establishmentId);
    const idempotencyKey = this.requireIdempotencyKey(rawIdempotencyKey);
    if (current.status === target) return this.getForResponse(organizationId, quoteId);
    if (current.idempotencyKey === idempotencyKey) throw new ConflictException('Idempotency key was already used for another quote operation');
    if (!this.isLegalTransition(current.status, target)) throw new ConflictException(`Quote cannot transition from ${current.status} to ${target}`);
    const event = this.eventContext();
    return this.prisma.$transaction(async (tx) => {
      const changed = await tx.quote.updateMany({ where: { id: quoteId, organizationId, status: current.status }, data: { status: target, idempotencyKey } });
      if (changed.count === 0) {
        const latest = await tx.quote.findFirst({ where: { id: quoteId, organizationId }, select: quoteSelect });
        if (!latest) throw new NotFoundException();
        if (latest.status === target) return this.serialize(latest);
        throw new ConflictException('Quote was changed concurrently');
      }
      const quote = await tx.quote.findFirstOrThrow({ where: { id: quoteId, organizationId }, select: quoteSelect });
      await this.recordMutation(tx, 'QUOTE_STATUS_CHANGED', 'sales.quote.status_changed', principal, organizationId, quote.establishmentId, quoteId, event, { previousStatus: current.status, status: quote.status });
      return this.serialize(quote);
    });
  }

  private async prepareLines(tx: Prisma.TransactionClient, organizationId: string, currency: string, inputLines: CreateQuoteLineDto[]): Promise<PreparedLine[]> {
    return Promise.all(inputLines.map(async (line) => {
      const item = line.itemId ? await tx.item.findFirst({ where: { id: line.itemId, organizationId, active: true }, select: { id: true, name: true, sku: true, description: true, unit: true, currency: true } }) : null;
      if (line.itemId && !item) throw new NotFoundException('Active catalog item not found');
      if (item) this.money.assertCurrencyMatch(currency, item.currency);
      const descriptionSnapshot = item?.description?.trim() || item?.name || line.descriptionSnapshot.trim();
      const unitSnapshot = item?.unit || line.unitSnapshot.trim();
      const itemNameSnapshot = item?.name || line.descriptionSnapshot.trim();
      const calculation = this.money.calculateLine({ quantity: line.quantity, unitPrice: line.unitPrice, discountAmount: line.discountAmount ?? '0', taxMode: line.taxMode, taxRate: line.taxRate ?? '0' });
      return { itemId: item?.id ?? null, itemNameSnapshot, itemSkuSnapshot: item?.sku ?? null, descriptionSnapshot, unitSnapshot, taxCodeSnapshot: line.taxCodeSnapshot?.trim() || null, quantity: line.quantity, unitPrice: line.unitPrice, discountAmount: line.discountAmount ?? '0', taxMode: line.taxMode, taxRate: line.taxRate ?? '0', ...calculation };
    }));
  }

  private async recordMutation(tx: Prisma.TransactionClient, action: AuditAction, eventType: string, principal: AuthPrincipal, organizationId: string, establishmentId: string, quoteId: string, context: { requestId: string; correlationId: string }, payload: Record<string, unknown>): Promise<void> {
    await tx.auditEvent.create({ data: { id: randomUUID(), action, actorUserId: principal.userId, organizationId, establishmentId, targetType: 'Quote', targetId: quoteId, requestId: context.requestId, correlationId: context.correlationId, metadataJson: payload as Prisma.InputJsonValue } });
    await this.outbox.enqueue(tx, createDomainEvent({ eventType, eventVersion: 1, occurredAt: new Date().toISOString(), actor: { type: 'USER', id: principal.userId }, aggregate: { type: 'Quote', id: quoteId }, organizationId, establishmentId, correlationId: context.correlationId, requestId: context.requestId, dataClassification: 'CONFIDENTIAL', purpose: 'sales-quote', payload }));
  }

  private async getForResponse(organizationId: string, quoteId: string): Promise<unknown> {
    const quote = await this.prisma.quote.findFirst({ where: { id: quoteId, organizationId }, select: quoteSelect });
    if (!quote) throw new NotFoundException();
    return this.serialize(quote);
  }

  private serialize(quote: QuoteWithLines): unknown {
    return { id: quote.id, organizationId: quote.organizationId, establishmentId: quote.establishmentId, number: quote.number, partyId: quote.partyId, status: quote.status, currency: quote.currency.trim(), validUntil: quote.validUntil?.toISOString().slice(0, 10) ?? null, lines: quote.lines.map((line) => ({ lineIndex: line.lineIndex, itemId: line.itemId, skuSnapshot: line.itemSkuSnapshot, descriptionSnapshot: line.descriptionSnapshot ?? '', unitSnapshot: line.unitSnapshot, quantity: line.quantity.toFixed(6), unitPrice: line.unitPrice.toFixed(4), discountAmount: line.discountAmount.toFixed(4), taxMode: line.taxMode, taxCodeSnapshot: line.taxCodeSnapshot, taxRate: line.taxRate.toFixed(4), taxAmount: line.taxAmount.toFixed(4), netAmount: line.netAmount.toFixed(4), grossAmount: line.grossAmount.toFixed(4) })), totalNet: quote.totalNet.toFixed(4), totalTax: quote.totalTax.toFixed(4), totalGross: quote.totalGross.toFixed(4), createdAt: quote.createdAt.toISOString(), updatedAt: quote.updatedAt.toISOString() };
  }

  private eventContext(): { requestId: string; correlationId: string } { const eventContext = currentEventContext(); return eventContext?.requestId ? { requestId: eventContext.requestId, correlationId: eventContext.correlationId } : createRequestContext(); }

  private requireIdempotencyKey(value?: string): string { if (!value || !value.trim() || value.length > 200 || /[\r\n]/.test(value)) throw new BadRequestException('Idempotency-Key is required and invalid'); return value.trim(); }

  private dateOnly(value: string): Date { if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00.000Z`))) throw new BadRequestException('Date must use YYYY-MM-DD'); return new Date(`${value}T00:00:00.000Z`); }

  private sum(values: string[]): string { return values.reduce((total, value) => total.add(new Prisma.Decimal(value)), new Prisma.Decimal(0)).toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP).toFixed(4); }

  private isLegalTransition(current: QuoteStatus, target: QuoteStatus): boolean { return (current === 'DRAFT' && (target === 'SENT' || target === 'CANCELLED')) || (current === 'SENT' && (target === 'ACCEPTED' || target === 'REJECTED' || target === 'EXPIRED' || target === 'CANCELLED')); }

  private normalizeCalculationError(error: unknown): unknown { if (error instanceof Error && /must be|cannot|not supported|mismatch|greater than|invalid/i.test(error.message)) return new BadRequestException(error.message); return error; }

  private encodeCursor(cursor: QuoteCursor): string { return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url'); }

  private decodeCursor(value: string): QuoteCursor { try { const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Partial<QuoteCursor>; if (typeof parsed.createdAt !== 'string' || typeof parsed.id !== 'string' || Number.isNaN(Date.parse(parsed.createdAt))) throw new Error('invalid'); return { createdAt: parsed.createdAt, id: parsed.id }; } catch { throw new BadRequestException('Cursor is invalid'); } }
}
