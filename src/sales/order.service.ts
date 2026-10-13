import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type AuditAction, type SalesOrderStatus } from '@prisma/client';
import { PrismaService } from '../database/prisma.service.js';
import { createDomainEvent } from '../events/domain-event.factory.js';
import { createRequestContext, currentEventContext } from '../events/event-context.js';
import { PrismaOutboxWriter } from '../events/prisma-outbox.writer.js';
import type { AuthPrincipal } from '../auth/auth.types.js';
import { AuthorizationService } from '../tenancy/authorization.service.js';
import { MoneyCalculator } from './money.js';
import { NumberingService } from './numbering.service.js';
import { SalesDocumentType, type TaxMode } from './sales.types.js';
import type { CreateSalesOrderDto, CreateSalesOrderLineDto, OrderListQuery, UpdateSalesOrderDto } from './order.dto.js';

type OrderCursor = { createdAt: string; id: string };
type PreparedOrderLine = {
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

const orderSelect = {
  id: true,
  organizationId: true,
  establishmentId: true,
  number: true,
  sourceQuoteId: true,
  status: true,
  partyId: true,
  currency: true,
  totalNet: true,
  totalTax: true,
  totalGross: true,
  createdAt: true,
  updatedAt: true,
  lines: {
    orderBy: { lineIndex: 'asc' },
    select: {
      lineIndex: true,
      itemId: true,
      itemSkuSnapshot: true,
      descriptionSnapshot: true,
      unitSnapshot: true,
      taxCodeSnapshot: true,
      quantity: true,
      unitPrice: true,
      discountAmount: true,
      taxMode: true,
      taxRate: true,
      netAmount: true,
      taxAmount: true,
      grossAmount: true,
    },
  },
} as const;

type OrderWithLines = Prisma.SalesOrderGetPayload<{ select: typeof orderSelect }>;

const quoteSourceSelect = {
  id: true,
  organizationId: true,
  establishmentId: true,
  number: true,
  status: true,
  partyId: true,
  currency: true,
  totalNet: true,
  totalTax: true,
  totalGross: true,
  lines: {
    orderBy: { lineIndex: 'asc' },
    select: {
      lineIndex: true,
      itemId: true,
      itemNameSnapshot: true,
      itemSkuSnapshot: true,
      descriptionSnapshot: true,
      unitSnapshot: true,
      taxCodeSnapshot: true,
      quantity: true,
      unitPrice: true,
      discountAmount: true,
      taxMode: true,
      taxRate: true,
      netAmount: true,
      taxAmount: true,
      grossAmount: true,
    },
  },
} as const;

@Injectable()
export class OrderService {
  private readonly money = new MoneyCalculator();
  private readonly numbering = new NumberingService();

  constructor(private readonly prisma: PrismaService, private readonly authorization: AuthorizationService, private readonly outbox: PrismaOutboxWriter) {}

  async list(principal: AuthPrincipal, organizationId: string, query: OrderListQuery): Promise<unknown> {
    const context = await this.authorization.requireModule(principal, organizationId, 'SALES', 'sales:orders:read');
    const establishmentIds = context.scopeMode === 'SELECTED_ESTABLISHMENTS' ? Array.from(context.establishmentIds) : undefined;
    const limit = query.limit ?? 20;
    const cursor = query.cursor ? this.decodeCursor(query.cursor) : undefined;
    const rows = await this.prisma.salesOrder.findMany({
      where: { organizationId, ...(establishmentIds ? { establishmentId: { in: establishmentIds } } : {}), ...(cursor ? { OR: [{ createdAt: { gt: new Date(cursor.createdAt) } }, { createdAt: new Date(cursor.createdAt), id: { gt: cursor.id } }] } : {}) },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: limit + 1,
      select: orderSelect,
    });
    const items = rows.slice(0, limit).map((order) => this.serialize(order));
    const next = rows.length > limit ? rows[limit - 1] : undefined;
    return { items, nextCursor: next ? this.encodeCursor({ createdAt: next.createdAt.toISOString(), id: next.id }) : null };
  }

  async get(principal: AuthPrincipal, organizationId: string, orderId: string): Promise<unknown> {
    const context = await this.authorization.requireModule(principal, organizationId, 'SALES', 'sales:orders:read');
    const order = await this.prisma.salesOrder.findFirst({ where: { id: orderId, organizationId }, select: orderSelect });
    if (!order) throw new NotFoundException();
    await this.authorization.assertEstablishment(context, order.establishmentId);
    return this.serialize(order);
  }

  async create(principal: AuthPrincipal, organizationId: string, input: CreateSalesOrderDto, rawIdempotencyKey?: string): Promise<unknown> {
    const context = await this.authorization.requireModule(principal, organizationId, 'SALES', 'sales:orders:write');
    await this.authorization.assertEstablishment(context, input.establishmentId);
    const idempotencyKey = this.requireIdempotencyKey(rawIdempotencyKey);
    const currency = input.currency.toUpperCase();
    const organization = await this.prisma.organization.findUnique({ where: { id: organizationId }, select: { defaultCurrency: true } });
    if (!organization) throw new NotFoundException();
    if (organization.defaultCurrency !== currency) throw new BadRequestException('Sales order currency must match the organization default currency');
    const event = this.eventContext();
    try {
      return await this.prisma.$transaction(async (tx) => {
        const existing = await tx.salesOrder.findFirst({ where: { organizationId, idempotencyKey }, select: orderSelect });
        if (existing) {
          if (existing.establishmentId !== input.establishmentId || existing.partyId !== input.partyId || existing.currency.trim() !== currency) {
            throw new ConflictException('Idempotency key was already used for another order');
          }
          return this.serialize(existing);
        }
        const party = await tx.businessParty.findFirst({ where: { id: input.partyId, organizationId, active: true }, select: { id: true } });
        if (!party) throw new NotFoundException('Business party not found');
        const lines = await this.prepareLines(tx, organizationId, currency, input.lines);
        const id = randomUUID();
        const number = await this.numbering.allocate(SalesDocumentType.SALES_ORDER, organizationId, new Date().getUTCFullYear(), tx);
        const order = await tx.salesOrder.create({
          data: {
            id,
            organizationId,
            establishmentId: input.establishmentId,
            number,
            partyId: input.partyId,
            currency,
            totalNet: this.sum(lines.map((line) => line.netAmount)),
            totalTax: this.sum(lines.map((line) => line.taxAmount)),
            totalGross: this.sum(lines.map((line) => line.grossAmount)),
            idempotencyKey,
            createdByUserId: principal.userId,
            lines: { create: lines.map((line, index) => ({ id: randomUUID(), lineIndex: index + 1, ...line })) },
          },
          select: orderSelect,
        });
        await this.recordMutation(tx, 'ORDER_CREATED', 'sales.order.created', principal, organizationId, order.establishmentId, order.id, event, { status: order.status, number: order.number, currency: order.currency, totalGross: order.totalGross.toFixed(4) });
        return this.serialize(order);
      });
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        const existing = await this.prisma.salesOrder.findFirst({ where: { organizationId, idempotencyKey }, select: orderSelect });
        if (existing) {
          if (existing.establishmentId !== input.establishmentId || existing.partyId !== input.partyId || existing.currency.trim() !== currency) {
            throw new ConflictException('Idempotency key was already used for another order');
          }
          return this.serialize(existing);
        }
        throw new ConflictException('Sales order conflicts with an existing record');
      }
      throw this.normalizeCalculationError(error);
    }
  }

  async convertFromQuote(principal: AuthPrincipal, organizationId: string, quoteId: string, rawIdempotencyKey?: string): Promise<unknown> {
    const context = await this.authorization.requireModule(principal, organizationId, 'SALES', 'sales:orders:write');
    const idempotencyKey = this.requireIdempotencyKey(rawIdempotencyKey);
    const quote = await this.prisma.quote.findFirst({ where: { id: quoteId, organizationId }, select: { establishmentId: true } });
    if (!quote) throw new NotFoundException();
    await this.authorization.assertEstablishment(context, quote.establishmentId);
    const event = this.eventContext();
    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw(Prisma.sql`SELECT id FROM "quotes" WHERE id = ${quoteId}::uuid AND organization_id = ${organizationId}::uuid FOR UPDATE`);
        const source = await tx.quote.findFirst({ where: { id: quoteId, organizationId }, select: quoteSourceSelect });
        if (!source) throw new NotFoundException();
        const bySource = await tx.salesOrder.findFirst({ where: { organizationId, sourceQuoteId: quoteId }, select: orderSelect });
        if (bySource) return this.serialize(bySource);
        const byKey = await tx.salesOrder.findFirst({ where: { organizationId, idempotencyKey }, select: orderSelect });
        if (byKey) throw new ConflictException('Idempotency key was already used for another order');
        if (source.status !== 'ACCEPTED') throw new ConflictException(`Quote cannot be converted from ${source.status}`);
        const id = randomUUID();
        const number = await this.numbering.allocate(SalesDocumentType.SALES_ORDER, organizationId, new Date().getUTCFullYear(), tx);
        const order = await tx.salesOrder.create({
          data: {
            id,
            organizationId,
            establishmentId: source.establishmentId,
            number,
            partyId: source.partyId,
            sourceQuoteId: source.id,
            currency: source.currency,
            totalNet: source.totalNet,
            totalTax: source.totalTax,
            totalGross: source.totalGross,
            idempotencyKey,
            createdByUserId: principal.userId,
            lines: { create: source.lines.map((line) => ({ id: randomUUID(), lineIndex: line.lineIndex, itemId: line.itemId, itemNameSnapshot: line.itemNameSnapshot, itemSkuSnapshot: line.itemSkuSnapshot, descriptionSnapshot: line.descriptionSnapshot, unitSnapshot: line.unitSnapshot, taxCodeSnapshot: line.taxCodeSnapshot, quantity: line.quantity, unitPrice: line.unitPrice, discountAmount: line.discountAmount, taxMode: line.taxMode, taxRate: line.taxRate, netAmount: line.netAmount, taxAmount: line.taxAmount, grossAmount: line.grossAmount })) },
          },
          select: orderSelect,
        });
        await this.recordMutation(tx, 'ORDER_CREATED', 'sales.order.created', principal, organizationId, order.establishmentId, order.id, event, { status: order.status, number: order.number, sourceQuoteId: source.id, totalGross: order.totalGross.toFixed(4) });
        return this.serialize(order);
      });
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        const existing = await this.prisma.salesOrder.findFirst({ where: { organizationId, sourceQuoteId: quoteId }, select: orderSelect });
        if (existing) return this.serialize(existing);
        throw new ConflictException('Quote conversion conflicts with an existing order');
      }
      throw error;
    }
  }

  async update(principal: AuthPrincipal, organizationId: string, orderId: string, input: UpdateSalesOrderDto, rawIdempotencyKey?: string): Promise<unknown> {
    const context = await this.authorization.requireModule(principal, organizationId, 'SALES', 'sales:orders:write');
    const current = await this.prisma.salesOrder.findFirst({ where: { id: orderId, organizationId }, select: { id: true, status: true, establishmentId: true, currency: true, idempotencyKey: true } });
    if (!current) throw new NotFoundException();
    await this.authorization.assertEstablishment(context, current.establishmentId);
    if (Object.keys(input).length === 0) throw new BadRequestException('At least one sales order field is required');
    if (current.status !== 'DRAFT') throw new ConflictException(`Sales order cannot be edited from ${current.status}`);
    const idempotencyKey = this.requireIdempotencyKey(rawIdempotencyKey);
    if (current.idempotencyKey === idempotencyKey) return this.getForResponse(organizationId, orderId);
    const event = this.eventContext();
    try {
      return await this.prisma.$transaction(async (tx) => {
        const lines = input.lines ? await this.prepareLines(tx, organizationId, current.currency, input.lines) : undefined;
        const changed = await tx.salesOrder.updateMany({ where: { id: orderId, organizationId, status: 'DRAFT' }, data: { ...(lines ? { totalNet: this.sum(lines.map((line) => line.netAmount)), totalTax: this.sum(lines.map((line) => line.taxAmount)), totalGross: this.sum(lines.map((line) => line.grossAmount)) } : {}), idempotencyKey } });
        if (changed.count === 0) {
          const latest = await tx.salesOrder.findFirst({ where: { id: orderId, organizationId }, select: { status: true, idempotencyKey: true } });
          if (!latest) throw new NotFoundException();
          if (latest.idempotencyKey === idempotencyKey) return this.getForResponse(organizationId, orderId);
          throw new ConflictException(`Sales order cannot be edited from ${latest.status}`);
        }
        if (lines) {
          await tx.salesOrderLine.deleteMany({ where: { salesOrderId: orderId, organizationId } });
          await tx.salesOrderLine.createMany({ data: lines.map((line, index) => ({ id: randomUUID(), organizationId, salesOrderId: orderId, lineIndex: index + 1, ...line })) });
        }
        const order = await tx.salesOrder.findFirstOrThrow({ where: { id: orderId, organizationId }, select: orderSelect });
        await this.recordMutation(tx, 'ORDER_UPDATED', 'sales.order.updated', principal, organizationId, order.establishmentId, order.id, event, { fields: Object.keys(input) });
        return this.serialize(order);
      });
    } catch (error) {
      throw this.normalizeCalculationError(error);
    }
  }

  async transition(principal: AuthPrincipal, organizationId: string, orderId: string, target: SalesOrderStatus, rawIdempotencyKey?: string): Promise<unknown> {
    const context = await this.authorization.requireModule(principal, organizationId, 'SALES', 'sales:orders:write');
    const current = await this.prisma.salesOrder.findFirst({ where: { id: orderId, organizationId }, select: { status: true, establishmentId: true, idempotencyKey: true } });
    if (!current) throw new NotFoundException();
    await this.authorization.assertEstablishment(context, current.establishmentId);
    const idempotencyKey = this.requireIdempotencyKey(rawIdempotencyKey);
    if (current.status === target) return this.getForResponse(organizationId, orderId);
    if (current.idempotencyKey === idempotencyKey) throw new ConflictException('Idempotency key was already used for another order operation');
    if (current.status !== 'DRAFT' || !['CONFIRMED', 'CANCELLED'].includes(target)) throw new ConflictException(`Sales order cannot transition from ${current.status} to ${target}`);
    const event = this.eventContext();
    return this.prisma.$transaction(async (tx) => {
      const changed = await tx.salesOrder.updateMany({ where: { id: orderId, organizationId, status: 'DRAFT' }, data: { status: target, idempotencyKey } });
      if (changed.count === 0) {
        const latest = await tx.salesOrder.findFirst({ where: { id: orderId, organizationId }, select: orderSelect });
        if (!latest) throw new NotFoundException();
        if (latest.status === target) return this.serialize(latest);
        throw new ConflictException('Sales order was changed concurrently');
      }
      const order = await tx.salesOrder.findFirstOrThrow({ where: { id: orderId, organizationId }, select: orderSelect });
      await this.recordMutation(tx, 'ORDER_STATUS_CHANGED', 'sales.order.status_changed', principal, organizationId, order.establishmentId, order.id, event, { previousStatus: current.status, status: order.status });
      return this.serialize(order);
    });
  }

  private async prepareLines(tx: Prisma.TransactionClient, organizationId: string, currency: string, inputLines: CreateSalesOrderLineDto[]): Promise<PreparedOrderLine[]> {
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

  private async recordMutation(tx: Prisma.TransactionClient, action: AuditAction, eventType: string, principal: AuthPrincipal, organizationId: string, establishmentId: string, orderId: string, context: { requestId: string; correlationId: string }, payload: Record<string, unknown>): Promise<void> {
    await tx.auditEvent.create({ data: { id: randomUUID(), action, actorUserId: principal.userId, organizationId, establishmentId, targetType: 'SalesOrder', targetId: orderId, requestId: context.requestId, correlationId: context.correlationId, metadataJson: payload as Prisma.InputJsonValue } });
    await this.outbox.enqueue(tx, createDomainEvent({ eventType, eventVersion: 1, occurredAt: new Date().toISOString(), actor: { type: 'USER', id: principal.userId }, aggregate: { type: 'SalesOrder', id: orderId }, organizationId, establishmentId, correlationId: context.correlationId, requestId: context.requestId, dataClassification: 'CONFIDENTIAL', purpose: 'sales-order', payload }));
  }

  private async getForResponse(organizationId: string, orderId: string): Promise<unknown> {
    const order = await this.prisma.salesOrder.findFirst({ where: { id: orderId, organizationId }, select: orderSelect });
    if (!order) throw new NotFoundException();
    return this.serialize(order);
  }

  private serialize(order: OrderWithLines): unknown {
    return { id: order.id, organizationId: order.organizationId, establishmentId: order.establishmentId, number: order.number, sourceQuoteId: order.sourceQuoteId, partyId: order.partyId, status: order.status, currency: order.currency.trim(), lines: order.lines.map((line) => ({ lineIndex: line.lineIndex, itemId: line.itemId, skuSnapshot: line.itemSkuSnapshot, descriptionSnapshot: line.descriptionSnapshot ?? '', unitSnapshot: line.unitSnapshot, quantity: line.quantity.toFixed(6), unitPrice: line.unitPrice.toFixed(4), discountAmount: line.discountAmount.toFixed(4), taxMode: line.taxMode, taxCodeSnapshot: line.taxCodeSnapshot, taxRate: line.taxRate.toFixed(4), taxAmount: line.taxAmount.toFixed(4), netAmount: line.netAmount.toFixed(4), grossAmount: line.grossAmount.toFixed(4) })), totalNet: order.totalNet.toFixed(4), totalTax: order.totalTax.toFixed(4), totalGross: order.totalGross.toFixed(4), createdAt: order.createdAt.toISOString(), updatedAt: order.updatedAt.toISOString() };
  }

  private eventContext(): { requestId: string; correlationId: string } { const eventContext = currentEventContext(); return eventContext?.requestId ? { requestId: eventContext.requestId, correlationId: eventContext.correlationId } : createRequestContext(); }
  private requireIdempotencyKey(value?: string): string { if (!value || !value.trim() || value.length > 200 || /[\r\n]/.test(value)) throw new BadRequestException('Idempotency-Key is required and invalid'); return value.trim(); }
  private sum(values: string[]): string { return values.reduce((total, value) => total.add(new Prisma.Decimal(value)), new Prisma.Decimal(0)).toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP).toFixed(4); }
  private normalizeCalculationError(error: unknown): unknown { if (error instanceof Error && /must be|cannot|not supported|mismatch|greater than|invalid/i.test(error.message)) return new BadRequestException(error.message); return error; }
  private isUniqueViolation(error: unknown): boolean { return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'; }
  private encodeCursor(cursor: OrderCursor): string { return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url'); }
  private decodeCursor(value: string): OrderCursor { try { const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Partial<OrderCursor>; if (typeof parsed.createdAt !== 'string' || typeof parsed.id !== 'string' || Number.isNaN(Date.parse(parsed.createdAt))) throw new Error('invalid'); return { createdAt: parsed.createdAt, id: parsed.id }; } catch { throw new BadRequestException('Cursor is invalid'); } }
}
