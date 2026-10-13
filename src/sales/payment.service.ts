import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type AuditAction, type InvoiceStatus } from '@prisma/client';
import { PrismaService } from '../database/prisma.service.js';
import { createDomainEvent } from '../events/domain-event.factory.js';
import { createRequestContext, currentEventContext } from '../events/event-context.js';
import { PrismaOutboxWriter } from '../events/prisma-outbox.writer.js';
import type { AuthPrincipal } from '../auth/auth.types.js';
import { AuthorizationService } from '../tenancy/authorization.service.js';
import type { CreatePaymentRecordDto, PaymentListQuery } from './payment.dto.js';

type PaymentCursor = { recordedAt: string; id: string };

const paymentSelect = {
  id: true,
  organizationId: true,
  establishmentId: true,
  invoiceId: true,
  amount: true,
  currency: true,
  methodCode: true,
  reference: true,
  status: true,
  reversalOfId: true,
  recordedAt: true,
  recordedByUserId: true,
} as const;

type Payment = Prisma.PaymentRecordGetPayload<{ select: typeof paymentSelect }>;

@Injectable()
export class PaymentService {
  constructor(private readonly prisma: PrismaService, private readonly authorization: AuthorizationService, private readonly outbox: PrismaOutboxWriter) {}

  async list(principal: AuthPrincipal, organizationId: string, invoiceId: string, query: PaymentListQuery): Promise<unknown> {
    const context = await this.authorization.requireModule(principal, organizationId, 'SALES', 'sales:payments:read');
    const invoice = await this.prisma.invoice.findFirst({ where: { id: invoiceId, organizationId }, select: { establishmentId: true } });
    if (!invoice) throw new NotFoundException();
    await this.authorization.assertEstablishment(context, invoice.establishmentId);
    const limit = query.limit ?? 20;
    const cursor = query.cursor ? this.decodeCursor(query.cursor) : undefined;
    const rows = await this.prisma.paymentRecord.findMany({
      where: { organizationId, invoiceId, ...(cursor ? { OR: [{ recordedAt: { gt: new Date(cursor.recordedAt) } }, { recordedAt: new Date(cursor.recordedAt), id: { gt: cursor.id } }] } : {}) },
      orderBy: [{ recordedAt: 'asc' }, { id: 'asc' }],
      take: limit + 1,
      select: paymentSelect,
    });
    const items = rows.slice(0, limit).map((payment) => this.serialize(payment));
    const next = rows.length > limit ? rows[limit - 1] : undefined;
    return { items, nextCursor: next ? this.encodeCursor({ recordedAt: next.recordedAt.toISOString(), id: next.id }) : null };
  }

  async record(principal: AuthPrincipal, organizationId: string, invoiceId: string, input: CreatePaymentRecordDto, rawIdempotencyKey?: string): Promise<unknown> {
    const context = await this.authorization.requireModule(principal, organizationId, 'SALES', 'sales:payments:write');
    const idempotencyKey = this.requireIdempotencyKey(rawIdempotencyKey);
    const amount = new Prisma.Decimal(input.amount);
    if (!amount.isFinite() || amount.isNegative() || amount.isZero()) throw new BadRequestException('Payment amount must be greater than zero');
    const currency = input.currency.toUpperCase();
    const recordedAt = new Date(input.paidAt);
    if (Number.isNaN(recordedAt.getTime())) throw new BadRequestException('paidAt is invalid');
    const event = this.eventContext();
    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw(Prisma.sql`SELECT id FROM "invoices" WHERE id = ${invoiceId}::uuid AND organization_id = ${organizationId}::uuid FOR UPDATE`);
        const invoice = await tx.invoice.findFirst({ where: { id: invoiceId, organizationId }, select: { establishmentId: true, status: true, currency: true, totalGross: true } });
        if (!invoice) throw new NotFoundException();
        await this.authorization.assertEstablishment(context, invoice.establishmentId);
        const existing = await tx.paymentRecord.findFirst({ where: { organizationId, idempotencyKey }, select: paymentSelect });
        if (existing) {
          if (existing.invoiceId !== invoiceId || existing.amount.toFixed(4) !== amount.toFixed(4) || existing.currency.trim() !== currency) throw new ConflictException('Idempotency key was already used for another payment');
          return this.serialize(existing);
        }
        if (!['ISSUED', 'PARTIALLY_PAID'].includes(invoice.status)) throw new ConflictException(`Payment cannot be recorded for an invoice in ${invoice.status}`);
        if (invoice.currency.trim() !== currency) throw new BadRequestException('Payment currency must match the invoice currency');
        const paidAmount = await this.validPaymentTotal(tx, organizationId, invoiceId);
        if (paidAmount.add(amount).gt(invoice.totalGross)) throw new ConflictException('Payment exceeds the invoice outstanding balance');
        const payment = await tx.paymentRecord.create({ data: { id: randomUUID(), organizationId, establishmentId: invoice.establishmentId, invoiceId, amount, currency, methodCode: input.methodCode.trim(), reference: input.reference?.trim() || null, status: 'RECORDED', idempotencyKey, recordedAt, recordedByUserId: principal.userId }, select: paymentSelect });
        const newStatus = this.statusFor(invoice.totalGross, paidAmount.add(amount));
        await this.updateInvoiceStatus(tx, organizationId, invoiceId, invoice.status, newStatus, principal, invoice.establishmentId, event);
        await this.recordMutation(tx, 'PAYMENT_RECORDED', 'sales.payment_record.recorded', principal, organizationId, invoice.establishmentId, payment.id, event, { invoiceId, amount: payment.amount.toFixed(4), currency: payment.currency, status: payment.status });
        return this.serialize(payment);
      });
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        const existing = await this.prisma.paymentRecord.findFirst({ where: { organizationId, idempotencyKey }, select: paymentSelect });
        if (existing && existing.invoiceId === invoiceId && existing.amount.toFixed(4) === amount.toFixed(4) && existing.currency.trim() === currency) return this.serialize(existing);
        if (existing) throw new ConflictException('Idempotency key was already used for another payment');
      }
      throw error;
    }
  }

  async reverse(principal: AuthPrincipal, organizationId: string, paymentId: string, rawIdempotencyKey?: string): Promise<unknown> {
    const context = await this.authorization.requireModule(principal, organizationId, 'SALES', 'sales:payments:write');
    const idempotencyKey = this.requireIdempotencyKey(rawIdempotencyKey);
    const original = await this.prisma.paymentRecord.findFirst({ where: { id: paymentId, organizationId }, select: paymentSelect });
    if (!original) throw new NotFoundException();
    await this.authorization.assertEstablishment(context, original.establishmentId);
    const event = this.eventContext();
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM "invoices" WHERE id = ${original.invoiceId}::uuid AND organization_id = ${organizationId}::uuid FOR UPDATE`);
      const existingByKey = await tx.paymentRecord.findFirst({ where: { organizationId, idempotencyKey }, select: paymentSelect });
      if (existingByKey) {
        if (existingByKey.reversalOfId !== paymentId) throw new ConflictException('Idempotency key was already used for another payment reversal');
        return this.serialize(existingByKey);
      }
      const existingReversal = await tx.paymentRecord.findFirst({ where: { organizationId, reversalOfId: paymentId }, select: paymentSelect });
      if (existingReversal) return this.serialize(existingReversal);
      const current = await tx.paymentRecord.findFirst({ where: { id: paymentId, organizationId }, select: paymentSelect });
      if (!current) throw new NotFoundException();
      if (current.status !== 'RECORDED' || current.reversalOfId) throw new ConflictException('Payment is already reversed');
      const invoice = await tx.invoice.findFirst({ where: { id: current.invoiceId, organizationId }, select: { establishmentId: true, status: true, totalGross: true } });
      if (!invoice) throw new NotFoundException();
      const updatedOriginal = await tx.paymentRecord.update({ where: { id: current.id }, data: { status: 'REVERSED', reversedAt: new Date() }, select: paymentSelect });
      const reversal = await tx.paymentRecord.create({ data: { id: randomUUID(), organizationId, establishmentId: current.establishmentId, invoiceId: current.invoiceId, amount: current.amount, currency: current.currency, methodCode: 'REVERSAL', reference: `Reversal of ${current.id}`, status: 'REVERSED', reversalOfId: current.id, idempotencyKey, recordedAt: new Date(), recordedByUserId: principal.userId }, select: paymentSelect });
      const paidAmount = await this.validPaymentTotal(tx, organizationId, current.invoiceId);
      const newStatus = this.statusFor(invoice.totalGross, paidAmount);
      await this.updateInvoiceStatus(tx, organizationId, current.invoiceId, invoice.status, newStatus, principal, invoice.establishmentId, event);
      await this.recordMutation(tx, 'PAYMENT_REVERSED', 'sales.payment_record.reversed', principal, organizationId, invoice.establishmentId, reversal.id, event, { invoiceId: current.invoiceId, reversalOfId: updatedOriginal.id, amount: reversal.amount.toFixed(4), currency: reversal.currency, status: reversal.status });
      return this.serialize(reversal);
    });
  }

  private async validPaymentTotal(tx: Prisma.TransactionClient, organizationId: string, invoiceId: string): Promise<Prisma.Decimal> {
    const rows = await tx.paymentRecord.findMany({ where: { organizationId, invoiceId, status: 'RECORDED', reversalOfId: null }, select: { amount: true } });
    return rows.reduce((total, row) => total.add(row.amount), new Prisma.Decimal(0)).toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP);
  }

  private statusFor(totalGross: Prisma.Decimal, paidAmount: Prisma.Decimal): InvoiceStatus {
    if (paidAmount.gte(totalGross)) return 'PAID';
    if (paidAmount.gt(0)) return 'PARTIALLY_PAID';
    return 'ISSUED';
  }

  private async updateInvoiceStatus(tx: Prisma.TransactionClient, organizationId: string, invoiceId: string, currentStatus: InvoiceStatus, newStatus: InvoiceStatus, principal: AuthPrincipal, establishmentId: string, context: { requestId: string; correlationId: string }): Promise<void> {
    if (currentStatus === newStatus) return;
    await tx.invoice.updateMany({ where: { id: invoiceId, organizationId }, data: { status: newStatus } });
    await tx.auditEvent.create({ data: { id: randomUUID(), action: 'INVOICE_STATUS_CHANGED', actorUserId: principal.userId, organizationId, establishmentId, targetType: 'Invoice', targetId: invoiceId, requestId: context.requestId, correlationId: context.correlationId, metadataJson: { previousStatus: currentStatus, status: newStatus } } });
    await this.outbox.enqueue(tx, createDomainEvent({ eventType: 'sales.invoice.status_changed', eventVersion: 1, occurredAt: new Date().toISOString(), actor: { type: 'USER', id: principal.userId }, aggregate: { type: 'Invoice', id: invoiceId }, organizationId, establishmentId, correlationId: context.correlationId, requestId: context.requestId, dataClassification: 'CONFIDENTIAL', purpose: 'sales-invoice', payload: { previousStatus: currentStatus, status: newStatus } }));
  }

  private async recordMutation(tx: Prisma.TransactionClient, action: AuditAction, eventType: string, principal: AuthPrincipal, organizationId: string, establishmentId: string, paymentId: string, context: { requestId: string; correlationId: string }, payload: Record<string, unknown>): Promise<void> {
    await tx.auditEvent.create({ data: { id: randomUUID(), action, actorUserId: principal.userId, organizationId, establishmentId, targetType: 'PaymentRecord', targetId: paymentId, requestId: context.requestId, correlationId: context.correlationId, metadataJson: payload as Prisma.InputJsonValue } });
    await this.outbox.enqueue(tx, createDomainEvent({ eventType, eventVersion: 1, occurredAt: new Date().toISOString(), actor: { type: 'USER', id: principal.userId }, aggregate: { type: 'PaymentRecord', id: paymentId }, organizationId, establishmentId, correlationId: context.correlationId, requestId: context.requestId, dataClassification: 'CONFIDENTIAL', purpose: 'sales-payment', payload }));
  }

  private serialize(payment: Payment): unknown { return { id: payment.id, organizationId: payment.organizationId, establishmentId: payment.establishmentId, invoiceId: payment.invoiceId, amount: payment.amount.toFixed(4), currency: payment.currency.trim(), methodCode: payment.methodCode, reference: payment.reference, paidAt: payment.recordedAt.toISOString(), status: payment.status, recordedBy: payment.recordedByUserId, reversalOfId: payment.reversalOfId, createdAt: payment.recordedAt.toISOString() }; }
  private eventContext(): { requestId: string; correlationId: string } { const eventContext = currentEventContext(); return eventContext?.requestId ? { requestId: eventContext.requestId, correlationId: eventContext.correlationId } : createRequestContext(); }
  private requireIdempotencyKey(value?: string): string { if (!value || !value.trim() || value.length > 200 || /[\r\n]/.test(value)) throw new BadRequestException('Idempotency-Key is required and invalid'); return value.trim(); }
  private isUniqueViolation(error: unknown): boolean { return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'; }
  private encodeCursor(cursor: PaymentCursor): string { return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url'); }
  private decodeCursor(value: string): PaymentCursor { try { const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Partial<PaymentCursor>; if (typeof parsed.recordedAt !== 'string' || typeof parsed.id !== 'string' || Number.isNaN(Date.parse(parsed.recordedAt))) throw new Error('invalid'); return { recordedAt: parsed.recordedAt, id: parsed.id }; } catch { throw new BadRequestException('Cursor is invalid'); } }
}
