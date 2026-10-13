import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type AuditAction, type InvoiceStatus } from '@prisma/client';
import { PrismaService } from '../database/prisma.service.js';
import { createDomainEvent } from '../events/domain-event.factory.js';
import { createRequestContext, currentEventContext } from '../events/event-context.js';
import { PrismaOutboxWriter } from '../events/prisma-outbox.writer.js';
import type { AuthPrincipal } from '../auth/auth.types.js';
import { AuthorizationService } from '../tenancy/authorization.service.js';
import { MoneyCalculator } from './money.js';
import { NumberingService } from './numbering.service.js';
import { SalesDocumentType, type TaxMode } from './sales.types.js';
import type { CreateSalesOrderLineDto } from './order.dto.js';
import type { InvoiceListQuery, UpdateInvoiceDto } from './invoice.dto.js';

type InvoiceCursor = { createdAt: string; id: string };
type PreparedInvoiceLine = {
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

const invoiceSelect = {
  id: true,
  organizationId: true,
  establishmentId: true,
  number: true,
  status: true,
  sourceOrderId: true,
  partyId: true,
  currency: true,
  issuedAt: true,
  dueAt: true,
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
  payments: { select: { amount: true, status: true } },
} as const;

type InvoiceWithLines = Prisma.InvoiceGetPayload<{ select: typeof invoiceSelect }>;

const orderSourceSelect = {
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
export class InvoiceService {
  private readonly money = new MoneyCalculator();
  private readonly numbering = new NumberingService();

  constructor(private readonly prisma: PrismaService, private readonly authorization: AuthorizationService, private readonly outbox: PrismaOutboxWriter) {}

  async list(principal: AuthPrincipal, organizationId: string, query: InvoiceListQuery): Promise<unknown> {
    const context = await this.authorization.requireModule(principal, organizationId, 'SALES', 'sales:invoices:read');
    const establishmentIds = context.scopeMode === 'SELECTED_ESTABLISHMENTS' ? Array.from(context.establishmentIds) : undefined;
    const limit = query.limit ?? 20;
    const cursor = query.cursor ? this.decodeCursor(query.cursor) : undefined;
    const rows = await this.prisma.invoice.findMany({
      where: { organizationId, ...(establishmentIds ? { establishmentId: { in: establishmentIds } } : {}), ...(cursor ? { OR: [{ createdAt: { gt: new Date(cursor.createdAt) } }, { createdAt: new Date(cursor.createdAt), id: { gt: cursor.id } }] } : {}) },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: limit + 1,
      select: invoiceSelect,
    });
    const items = rows.slice(0, limit).map((invoice) => this.serialize(invoice));
    const next = rows.length > limit ? rows[limit - 1] : undefined;
    return { items, nextCursor: next ? this.encodeCursor({ createdAt: next.createdAt.toISOString(), id: next.id }) : null };
  }

  async get(principal: AuthPrincipal, organizationId: string, invoiceId: string): Promise<unknown> {
    const context = await this.authorization.requireModule(principal, organizationId, 'SALES', 'sales:invoices:read');
    const invoice = await this.prisma.invoice.findFirst({ where: { id: invoiceId, organizationId }, select: invoiceSelect });
    if (!invoice) throw new NotFoundException();
    await this.authorization.assertEstablishment(context, invoice.establishmentId);
    return this.serialize(invoice);
  }

  async convertFromOrder(principal: AuthPrincipal, organizationId: string, orderId: string, rawIdempotencyKey?: string): Promise<unknown> {
    const context = await this.authorization.requireModule(principal, organizationId, 'SALES', 'sales:invoices:write');
    const idempotencyKey = this.requireIdempotencyKey(rawIdempotencyKey);
    const order = await this.prisma.salesOrder.findFirst({ where: { id: orderId, organizationId }, select: { establishmentId: true } });
    if (!order) throw new NotFoundException();
    await this.authorization.assertEstablishment(context, order.establishmentId);
    const event = this.eventContext();
    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw(Prisma.sql`SELECT id FROM "sales_orders" WHERE id = ${orderId}::uuid AND organization_id = ${organizationId}::uuid FOR UPDATE`);
        const source = await tx.salesOrder.findFirst({ where: { id: orderId, organizationId }, select: orderSourceSelect });
        if (!source) throw new NotFoundException();
        const bySource = await tx.invoice.findFirst({ where: { organizationId, sourceOrderId: orderId }, select: invoiceSelect });
        if (bySource) return this.serialize(bySource);
        const byKey = await tx.invoice.findFirst({ where: { organizationId, idempotencyKey }, select: invoiceSelect });
        if (byKey) throw new ConflictException('Idempotency key was already used for another invoice');
        if (source.status !== 'CONFIRMED') throw new ConflictException(`Sales order cannot be invoiced from ${source.status}`);
        const id = randomUUID();
        const number = await this.numbering.allocate(SalesDocumentType.INVOICE, organizationId, new Date().getUTCFullYear(), tx);
        const invoice = await tx.invoice.create({
          data: {
            id,
            organizationId,
            establishmentId: source.establishmentId,
            number,
            partyId: source.partyId,
            sourceOrderId: source.id,
            currency: source.currency,
            totalNet: source.totalNet,
            totalTax: source.totalTax,
            totalGross: source.totalGross,
            idempotencyKey,
            createdByUserId: principal.userId,
            lines: { create: source.lines.map((line) => ({ id: randomUUID(), lineIndex: line.lineIndex, itemId: line.itemId, itemNameSnapshot: line.itemNameSnapshot, itemSkuSnapshot: line.itemSkuSnapshot, descriptionSnapshot: line.descriptionSnapshot, unitSnapshot: line.unitSnapshot, taxCodeSnapshot: line.taxCodeSnapshot, quantity: line.quantity, unitPrice: line.unitPrice, discountAmount: line.discountAmount, taxMode: line.taxMode, taxRate: line.taxRate, netAmount: line.netAmount, taxAmount: line.taxAmount, grossAmount: line.grossAmount })) },
          },
          select: invoiceSelect,
        });
        await this.recordMutation(tx, 'INVOICE_CREATED', 'sales.invoice.created', principal, organizationId, invoice.establishmentId, invoice.id, event, { status: invoice.status, number: invoice.number, sourceOrderId: source.id, totalGross: invoice.totalGross.toFixed(4) });
        return this.serialize(invoice);
      });
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        const existing = await this.prisma.invoice.findFirst({ where: { organizationId, sourceOrderId: orderId }, select: invoiceSelect });
        if (existing) return this.serialize(existing);
        throw new ConflictException('Order conversion conflicts with an existing invoice');
      }
      throw error;
    }
  }

  async update(principal: AuthPrincipal, organizationId: string, invoiceId: string, input: UpdateInvoiceDto, rawIdempotencyKey?: string): Promise<unknown> {
    const context = await this.authorization.requireModule(principal, organizationId, 'SALES', 'sales:invoices:write');
    const current = await this.prisma.invoice.findFirst({ where: { id: invoiceId, organizationId }, select: { id: true, status: true, establishmentId: true, currency: true, idempotencyKey: true } });
    if (!current) throw new NotFoundException();
    await this.authorization.assertEstablishment(context, current.establishmentId);
    if (Object.keys(input).length === 0) throw new BadRequestException('At least one invoice field is required');
    if (current.status !== 'DRAFT') throw new ConflictException(`Invoice cannot be edited from ${current.status}`);
    const idempotencyKey = this.requireIdempotencyKey(rawIdempotencyKey);
    if (current.idempotencyKey === idempotencyKey) return this.getForResponse(organizationId, invoiceId);
    const event = this.eventContext();
    try {
      return await this.prisma.$transaction(async (tx) => {
        const lines = input.lines ? await this.prepareLines(tx, organizationId, current.currency, input.lines) : undefined;
        const dueAt = input.dueAt === undefined ? undefined : this.dateOnly(input.dueAt);
        const changed = await tx.invoice.updateMany({ where: { id: invoiceId, organizationId, status: 'DRAFT' }, data: { ...(dueAt !== undefined ? { dueAt } : {}), ...(lines ? { totalNet: this.sum(lines.map((line) => line.netAmount)), totalTax: this.sum(lines.map((line) => line.taxAmount)), totalGross: this.sum(lines.map((line) => line.grossAmount)) } : {}), idempotencyKey } });
        if (changed.count === 0) {
          const latest = await tx.invoice.findFirst({ where: { id: invoiceId, organizationId }, select: { status: true, idempotencyKey: true } });
          if (!latest) throw new NotFoundException();
          if (latest.idempotencyKey === idempotencyKey) return this.getForResponse(organizationId, invoiceId);
          throw new ConflictException(`Invoice cannot be edited from ${latest.status}`);
        }
        if (lines) {
          await tx.invoiceLine.deleteMany({ where: { invoiceId, organizationId } });
          await tx.invoiceLine.createMany({ data: lines.map((line, index) => ({ id: randomUUID(), organizationId, invoiceId, lineIndex: index + 1, ...line })) });
        }
        const invoice = await tx.invoice.findFirstOrThrow({ where: { id: invoiceId, organizationId }, select: invoiceSelect });
        await this.recordMutation(tx, 'INVOICE_UPDATED', 'sales.invoice.updated', principal, organizationId, invoice.establishmentId, invoice.id, event, { fields: Object.keys(input) });
        return this.serialize(invoice);
      });
    } catch (error) {
      throw this.normalizeCalculationError(error);
    }
  }

  async transition(principal: AuthPrincipal, organizationId: string, invoiceId: string, target: InvoiceStatus, rawIdempotencyKey?: string): Promise<unknown> {
    const context = await this.authorization.requireModule(principal, organizationId, 'SALES', 'sales:invoices:write');
    const current = await this.prisma.invoice.findFirst({ where: { id: invoiceId, organizationId }, select: { status: true, establishmentId: true, idempotencyKey: true } });
    if (!current) throw new NotFoundException();
    await this.authorization.assertEstablishment(context, current.establishmentId);
    const idempotencyKey = this.requireIdempotencyKey(rawIdempotencyKey);
    if (current.status === target) return this.getForResponse(organizationId, invoiceId);
    if (current.idempotencyKey === idempotencyKey) throw new ConflictException('Idempotency key was already used for another invoice operation');
    if (target === 'ISSUED' && current.status !== 'DRAFT') throw new ConflictException(`Invoice cannot transition from ${current.status} to ${target}`);
    if (target === 'VOID' && current.status !== 'ISSUED') throw new ConflictException(`Invoice cannot transition from ${current.status} to ${target}`);
    const event = this.eventContext();
    return this.prisma.$transaction(async (tx) => {
      if (target === 'VOID') {
        await tx.$queryRaw(Prisma.sql`SELECT id FROM "invoices" WHERE id = ${invoiceId}::uuid AND organization_id = ${organizationId}::uuid FOR UPDATE`);
        const payment = await tx.paymentRecord.findFirst({ where: { invoiceId, organizationId, status: 'RECORDED' }, select: { id: true } });
        if (payment) throw new ConflictException('Invoice cannot be voided after a valid payment');
      }
      const changed = await tx.invoice.updateMany({ where: { id: invoiceId, organizationId, status: current.status }, data: { status: target, ...(target === 'ISSUED' ? { issuedAt: new Date() } : {}), idempotencyKey } });
      if (changed.count === 0) {
        const latest = await tx.invoice.findFirst({ where: { id: invoiceId, organizationId }, select: invoiceSelect });
        if (!latest) throw new NotFoundException();
        if (latest.status === target) return this.serialize(latest);
        throw new ConflictException('Invoice was changed concurrently');
      }
      const invoice = await tx.invoice.findFirstOrThrow({ where: { id: invoiceId, organizationId }, select: invoiceSelect });
      await this.recordMutation(tx, 'INVOICE_STATUS_CHANGED', 'sales.invoice.status_changed', principal, organizationId, invoice.establishmentId, invoice.id, event, { previousStatus: current.status, status: invoice.status });
      return this.serialize(invoice);
    });
  }

  private async prepareLines(tx: Prisma.TransactionClient, organizationId: string, currency: string, inputLines: CreateSalesOrderLineDto[]): Promise<PreparedInvoiceLine[]> {
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

  private async recordMutation(tx: Prisma.TransactionClient, action: AuditAction, eventType: string, principal: AuthPrincipal, organizationId: string, establishmentId: string, invoiceId: string, context: { requestId: string; correlationId: string }, payload: Record<string, unknown>): Promise<void> {
    await tx.auditEvent.create({ data: { id: randomUUID(), action, actorUserId: principal.userId, organizationId, establishmentId, targetType: 'Invoice', targetId: invoiceId, requestId: context.requestId, correlationId: context.correlationId, metadataJson: payload as Prisma.InputJsonValue } });
    await this.outbox.enqueue(tx, createDomainEvent({ eventType, eventVersion: 1, occurredAt: new Date().toISOString(), actor: { type: 'USER', id: principal.userId }, aggregate: { type: 'Invoice', id: invoiceId }, organizationId, establishmentId, correlationId: context.correlationId, requestId: context.requestId, dataClassification: 'CONFIDENTIAL', purpose: 'sales-invoice', payload }));
  }

  private async getForResponse(organizationId: string, invoiceId: string): Promise<unknown> {
    const invoice = await this.prisma.invoice.findFirst({ where: { id: invoiceId, organizationId }, select: invoiceSelect });
    if (!invoice) throw new NotFoundException();
    return this.serialize(invoice);
  }

  private serialize(invoice: InvoiceWithLines): unknown {
    const paidAmount = invoice.payments.filter((payment) => payment.status === 'RECORDED').reduce((total, payment) => total.add(payment.amount), new Prisma.Decimal(0)).toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP);
    const outstandingAmount = invoice.totalGross.sub(paidAmount).toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP);
    const status = paidAmount.gte(invoice.totalGross) && invoice.status !== 'DRAFT' && invoice.status !== 'VOID' ? 'PAID' : invoice.status;
    return { id: invoice.id, organizationId: invoice.organizationId, establishmentId: invoice.establishmentId, number: invoice.number, sourceOrderId: invoice.sourceOrderId, partyId: invoice.partyId, status, currency: invoice.currency.trim(), issuedAt: invoice.issuedAt?.toISOString() ?? null, dueAt: invoice.dueAt?.toISOString().slice(0, 10) ?? null, lines: invoice.lines.map((line) => ({ lineIndex: line.lineIndex, itemId: line.itemId, skuSnapshot: line.itemSkuSnapshot, descriptionSnapshot: line.descriptionSnapshot ?? '', unitSnapshot: line.unitSnapshot, quantity: line.quantity.toFixed(6), unitPrice: line.unitPrice.toFixed(4), discountAmount: line.discountAmount.toFixed(4), taxMode: line.taxMode, taxCodeSnapshot: line.taxCodeSnapshot, taxRate: line.taxRate.toFixed(4), taxAmount: line.taxAmount.toFixed(4), netAmount: line.netAmount.toFixed(4), grossAmount: line.grossAmount.toFixed(4) })), totalNet: invoice.totalNet.toFixed(4), totalTax: invoice.totalTax.toFixed(4), totalGross: invoice.totalGross.toFixed(4), paidAmount: paidAmount.toFixed(4), outstandingAmount: outstandingAmount.toFixed(4), createdAt: invoice.createdAt.toISOString(), updatedAt: invoice.updatedAt.toISOString() };
  }

  private eventContext(): { requestId: string; correlationId: string } { const eventContext = currentEventContext(); return eventContext?.requestId ? { requestId: eventContext.requestId, correlationId: eventContext.correlationId } : createRequestContext(); }
  private requireIdempotencyKey(value?: string): string { if (!value || !value.trim() || value.length > 200 || /[\r\n]/.test(value)) throw new BadRequestException('Idempotency-Key is required and invalid'); return value.trim(); }
  private dateOnly(value: string): Date { if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00.000Z`))) throw new BadRequestException('Date must use YYYY-MM-DD'); return new Date(`${value}T00:00:00.000Z`); }
  private sum(values: string[]): string { return values.reduce((total, value) => total.add(new Prisma.Decimal(value)), new Prisma.Decimal(0)).toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP).toFixed(4); }
  private normalizeCalculationError(error: unknown): unknown { if (error instanceof Error && /must be|cannot|not supported|mismatch|greater than|invalid/i.test(error.message)) return new BadRequestException(error.message); return error; }
  private isUniqueViolation(error: unknown): boolean { return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'; }
  private encodeCursor(cursor: InvoiceCursor): string { return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url'); }
  private decodeCursor(value: string): InvoiceCursor { try { const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Partial<InvoiceCursor>; if (typeof parsed.createdAt !== 'string' || typeof parsed.id !== 'string' || Number.isNaN(Date.parse(parsed.createdAt))) throw new Error('invalid'); return { createdAt: parsed.createdAt, id: parsed.id }; } catch { throw new BadRequestException('Cursor is invalid'); } }
}
