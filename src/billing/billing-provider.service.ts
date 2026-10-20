import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { BadRequestException, ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service.js';
import { PrismaOutboxWriter } from '../events/prisma-outbox.writer.js';
import { createDomainEvent } from '../events/domain-event.factory.js';
import { createRequestContext, currentEventContext, type EventContext } from '../events/event-context.js';
import type { VerifiedBillingProviderEvent } from './billing-provider.port.js';
import { addBillingPeriod } from './billing-period.js';

@Injectable()
export class BillingProviderService {
  constructor(private readonly prisma: PrismaService, private readonly outbox: PrismaOutboxWriter) {}

  async receiveWebhook(provider: string, eventId: string, signature: string, payload: Record<string, unknown>): Promise<{ accepted: true; duplicate: boolean }> {
    if (provider !== 'TEST' || process.env.NODE_ENV !== 'test') throw new UnauthorizedException('Billing provider is not enabled');
    const event = this.verifyTestWebhook(eventId, signature, payload);
    const context = currentEventContext() ?? createRequestContext();

    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.billingProviderEventInbox.findUnique({ where: { provider_providerEventId: { provider, providerEventId: event.providerEventId } } });
      const payloadHash = this.hashPayload(payload);
      if (existing) {
        if (existing.payloadHash !== payloadHash) throw new ConflictException('Provider event id was already used with a different payload');
        return { accepted: true, duplicate: true };
      }
      const attempt = await tx.billingPaymentAttempt.findFirst({ where: { provider, providerPaymentId: event.providerPaymentId }, include: { checkoutOrder: true } });
      if (!attempt || (!attempt.checkoutOrder && !attempt.invoiceId)) throw new ConflictException('Provider payment attempt is unknown');
      if (attempt.amountMinor !== event.amountMinor || attempt.currency.trim() !== event.currency) throw new ConflictException('Provider payment does not match the server amount and currency');
      const providerInboxId = randomUUID();
      await tx.billingProviderEventInbox.create({ data: { id: providerInboxId, provider, providerEventId: event.providerEventId, organizationId: attempt.organizationId, billingCustomerId: attempt.billingCustomerId, eventType: `payment.${event.status.toLowerCase()}`, payloadHash, status: 'RECEIVED' } });
      await tx.auditEvent.create({ data: { id: randomUUID(), action: 'BILLING_PROVIDER_EVENT_ACCEPTED', actorUserId: null, organizationId: attempt.organizationId, targetType: 'BillingProviderEvent', targetId: providerInboxId, requestId: context.requestId ?? null, correlationId: context.correlationId, metadataJson: { provider, providerEventId: event.providerEventId, eventType: event.status, amountMinor: event.amountMinor.toString(), currency: event.currency } } });
      await tx.$queryRaw(Prisma.sql`SELECT id FROM billing_payment_attempts WHERE id = ${attempt.id}::uuid FOR UPDATE`);
      const lockedAttempt = await tx.billingPaymentAttempt.findUniqueOrThrow({ where: { id: attempt.id }, include: { checkoutOrder: true } });
      const checkoutOrder = lockedAttempt.checkoutOrder;
      if (event.status === 'REFUNDED' || event.status === 'CHARGEBACK') {
        await this.reconcileReversal(tx, lockedAttempt, event, context, provider);
        await tx.billingProviderEventInbox.update({ where: { provider_providerEventId: { provider, providerEventId: event.providerEventId } }, data: { status: 'PROCESSED', processedAt: new Date(), attemptCount: { increment: 1 } } });
        return { accepted: true, duplicate: false };
      }
      if (!checkoutOrder && !lockedAttempt.invoiceId) throw new ConflictException('Payment attempt is not linked to a checkout order or invoice');
      if (lockedAttempt.status === 'SUCCEEDED' && event.status === 'SUCCEEDED') {
        await tx.billingProviderEventInbox.update({ where: { provider_providerEventId: { provider, providerEventId: event.providerEventId } }, data: { status: 'PROCESSED', processedAt: new Date(), attemptCount: { increment: 1 } } });
        return { accepted: true, duplicate: false };
      }
      if (event.status !== 'SUCCEEDED') {
        await tx.billingPaymentAttempt.update({ where: { id: lockedAttempt.id }, data: { status: 'FAILED', failureCode: event.status } });
        await tx.billingProviderEventInbox.update({ where: { provider_providerEventId: { provider, providerEventId: event.providerEventId } }, data: { status: 'PROCESSED', processedAt: new Date(), attemptCount: { increment: 1 } } });
        return { accepted: true, duplicate: false };
      }
      if (lockedAttempt.status === 'FAILED' || lockedAttempt.status === 'CANCELED') throw new ConflictException('A terminally failed payment attempt cannot be marked successful');
      if (lockedAttempt.invoiceId) {
        await this.settleRenewal(tx, lockedAttempt, event, context, provider);
        await tx.billingProviderEventInbox.update({ where: { provider_providerEventId: { provider, providerEventId: event.providerEventId } }, data: { status: 'PROCESSED', processedAt: new Date(), attemptCount: { increment: 1 } } });
        return { accepted: true, duplicate: false };
      }
      if (!checkoutOrder) throw new ConflictException('Payment attempt is not linked to a checkout order');
      await tx.$queryRaw(Prisma.sql`SELECT id FROM organizations WHERE id = ${checkoutOrder.organizationId}::uuid FOR UPDATE`);
      const existingTerm = await tx.billingSubscriptionTerm.findFirst({ where: { organizationId: checkoutOrder.organizationId, status: { in: ['PENDING', 'ACTIVE', 'PAST_DUE', 'SUSPENDED'] } }, select: { id: true } });
      if (existingTerm) throw new ConflictException('Organization already has an effective FairScale billing term');
      const quote = await tx.billingQuote.findUniqueOrThrow({ where: { id: checkoutOrder.quoteId }, include: { lines: true } });
      const planVersion = await tx.planVersion.findFirst({ where: { planCode: quote.planCode, billingPeriod: quote.billingPeriod, currency: 'USD', status: 'ACTIVE' }, orderBy: { version: 'desc' } });
      if (!planVersion) throw new ConflictException('No active plan version is available for the paid quote');
      const periodStart = new Date();
      const periodEnd = addBillingPeriod(periodStart, quote.billingPeriod);
      const currentSubscription = await tx.subscription.findFirst({ where: { organizationId: quote.organizationId, status: { in: ['TRIALING', 'ACTIVE', 'PAST_DUE', 'SUSPENDED'] }, startsAt: { lte: periodStart }, OR: [{ endsAt: null }, { endsAt: { gt: periodStart } }] }, include: { planVersion: true }, orderBy: [{ startsAt: 'desc' }, { createdAt: 'desc' }] });
      if (currentSubscription && currentSubscription.planVersion.planCode !== 'CONNECT') throw new ConflictException('Organization already has a paid subscription; use a scheduled plan change');
      if (currentSubscription) await tx.subscription.update({ where: { id: currentSubscription.id }, data: { status: 'EXPIRED', endsAt: periodStart } });
      const subscription = await tx.subscription.create({ data: { id: randomUUID(), organizationId: quote.organizationId, planVersionId: planVersion.id, status: 'ACTIVE', startsAt: periodStart, endsAt: periodEnd } });
      const addonUnitAmountMinor = quote.addonEstablishments > 0 ? quote.addonAmountMinor / BigInt(quote.addonEstablishments) : 0n;
      const term = await tx.billingSubscriptionTerm.create({ data: { id: randomUUID(), billingCustomerId: quote.billingCustomerId, organizationId: quote.organizationId, subscriptionId: subscription.id, sourceQuoteId: quote.id, status: 'ACTIVE', planCode: quote.planCode, billingPeriod: quote.billingPeriod, currency: quote.currency, catalogVersion: quote.catalogVersion, baseAmountMinor: quote.baseAmountMinor, discountAmountMinor: quote.discountAmountMinor, addonAmountMinor: quote.addonAmountMinor, totalAmountMinor: quote.totalAmountMinor, startsAt: periodStart, currentPeriodStart: periodStart, currentPeriodEnd: periodEnd, nextRenewalAt: periodEnd, ...(quote.addonEstablishments > 0 ? { addons: { create: { id: randomUUID(), organizationId: quote.organizationId, code: 'ESTABLISHMENT', status: 'ACTIVE', quantity: quote.addonEstablishments, billingPeriod: quote.billingPeriod, currency: quote.currency, unitAmountMinor: addonUnitAmountMinor, startsAt: periodStart } } } : {}) } });
      const sequenceRows = await tx.$queryRaw<Array<{ nextval: bigint }>>(Prisma.sql`SELECT nextval('billing_invoice_number_seq')`);
      const nextval = sequenceRows[0]?.nextval;
      if (nextval === undefined) throw new ConflictException('Billing invoice sequence is unavailable');
      const invoice = await tx.billingInvoice.create({ data: { id: randomUUID(), billingCustomerId: quote.billingCustomerId, organizationId: quote.organizationId, subscriptionTermId: term.id, checkoutOrderId: checkoutOrder.id, number: `MC-${periodStart.getUTCFullYear()}-${String(nextval).padStart(6, '0')}`, sequence: 1, status: 'PAID', currency: quote.currency, periodStart, periodEnd, subtotalMinor: quote.baseAmountMinor + quote.addonAmountMinor, discountMinor: quote.discountAmountMinor, totalMinor: quote.totalAmountMinor, amountPaidMinor: quote.totalAmountMinor, dueAt: periodStart, paidAt: periodStart, lines: { create: quote.lines.map((line, index) => ({ id: randomUUID(), lineIndex: index, code: line.code, description: line.description, quantity: line.quantity, unitAmountMinor: line.unitAmountMinor, discountMinor: line.discountAmountMinor, totalMinor: line.totalAmountMinor, currency: line.currency })) } }, include: { lines: true } });
      await tx.billingPayment.create({ data: { id: randomUUID(), paymentAttemptId: lockedAttempt.id, billingCustomerId: quote.billingCustomerId, organizationId: quote.organizationId, invoiceId: invoice.id, provider, externalTransactionId: event.providerPaymentId, status: 'SUCCEEDED', amountMinor: event.amountMinor, currency: event.currency } });
      await tx.billingPaymentAttempt.update({ where: { id: lockedAttempt.id }, data: { status: 'SUCCEEDED' } });
      await tx.billingCheckoutOrder.update({ where: { id: checkoutOrder.id }, data: { status: 'PAID', subscriptionTermId: term.id } });
      if (quote.promotionCode) {
        await tx.billingPromotionRedemption.updateMany({ where: { quoteId: quote.id, status: 'RESERVED' }, data: { status: 'CONSUMED', consumedAt: periodStart, billingInvoiceId: invoice.id } });
        if (quote.promotionCode === 'WELCOME_MONTHLY15') await tx.billingPromotionEligibility.updateMany({ where: { billingCustomerId: quote.billingCustomerId, promotionCode: quote.promotionCode }, data: { monthlyPaidCount: { increment: 1 }, eligible: true } });
        await tx.billingQuote.update({ where: { id: quote.id }, data: { promotionStatus: 'CONSUMED' } });
      }
      await tx.billingProviderEventInbox.update({ where: { provider_providerEventId: { provider, providerEventId: event.providerEventId } }, data: { status: 'PROCESSED', processedAt: new Date(), attemptCount: { increment: 1 } } });
      await tx.auditEvent.create({ data: { id: randomUUID(), action: 'BILLING_SUBSCRIPTION_CHANGED', actorUserId: null, organizationId: quote.organizationId, targetType: 'BillingSubscriptionTerm', targetId: term.id, requestId: context.requestId ?? null, correlationId: context.correlationId, metadataJson: { status: 'ACTIVE', invoiceId: invoice.id, provider, externalTransactionId: event.providerPaymentId } } });
      await this.outbox.enqueue(tx, createDomainEvent({ eventType: 'billing.payment.verified', eventVersion: 1, occurredAt: periodStart.toISOString(), actor: { type: 'PLATFORM' }, aggregate: { type: 'BillingPayment', id: invoice.id }, organizationId: quote.organizationId, correlationId: context.correlationId, ...(context.requestId ? { requestId: context.requestId } : {}), dataClassification: 'CONFIDENTIAL', purpose: 'fairscale-billing-payment', payload: { invoiceId: invoice.id, amountMinor: event.amountMinor.toString(), currency: event.currency, provider } }));
      return { accepted: true, duplicate: false };
    });
  }

  private async settleRenewal(tx: Prisma.TransactionClient, attempt: { id: string; invoiceId: string | null; billingCustomerId: string; organizationId: string; provider: string }, event: VerifiedBillingProviderEvent, context: EventContext, provider: string): Promise<void> {
    const invoiceId = attempt.invoiceId;
    if (!invoiceId) throw new ConflictException('Renewal payment attempt has no invoice');
    const invoice = await tx.billingInvoice.findUnique({ where: { id: invoiceId }, include: { subscriptionTerm: true } });
    if (!invoice || invoice.organizationId !== attempt.organizationId) throw new ConflictException('Billing invoice is not available');
    if (invoice.status === 'PAID' && invoice.amountPaidMinor === event.amountMinor) return;
    if (invoice.status !== 'OPEN') throw new ConflictException('Billing invoice is not payable');
    if (invoice.totalMinor !== event.amountMinor || invoice.currency.trim() !== event.currency) throw new ConflictException('Renewal payment does not match the invoice');
    await tx.billingPayment.create({ data: { id: randomUUID(), paymentAttemptId: attempt.id, billingCustomerId: attempt.billingCustomerId, organizationId: attempt.organizationId, invoiceId: invoice.id, provider, externalTransactionId: event.providerPaymentId, status: 'SUCCEEDED', amountMinor: event.amountMinor, currency: event.currency } });
    await tx.billingInvoice.update({ where: { id: invoice.id }, data: { status: 'PAID', amountPaidMinor: event.amountMinor, paidAt: new Date() } });
    await tx.billingPaymentAttempt.update({ where: { id: attempt.id }, data: { status: 'SUCCEEDED' } });
    const redemption = await tx.billingPromotionRedemption.findFirst({ where: { billingInvoiceId: invoice.id, promotionCode: 'WELCOME_MONTHLY15', status: 'RESERVED' } });
    if (redemption) {
      await tx.billingPromotionRedemption.update({ where: { id: redemption.id }, data: { status: 'CONSUMED', consumedAt: invoice.periodStart } });
      await tx.billingPromotionEligibility.update({ where: { billingCustomerId_promotionCode: { billingCustomerId: attempt.billingCustomerId, promotionCode: 'WELCOME_MONTHLY15' } }, data: { monthlyPaidCount: { increment: 1 } } });
    }
    await tx.billingSubscriptionTerm.update({ where: { id: invoice.subscriptionTermId }, data: { status: 'ACTIVE', currentPeriodStart: invoice.periodStart, currentPeriodEnd: invoice.periodEnd, nextRenewalAt: invoice.periodEnd } });
    await tx.subscription.update({ where: { id: invoice.subscriptionTerm.subscriptionId }, data: { status: 'ACTIVE', startsAt: invoice.periodStart, endsAt: invoice.periodEnd } });
    await tx.auditEvent.create({ data: { id: randomUUID(), action: 'BILLING_SUBSCRIPTION_CHANGED', actorUserId: null, organizationId: attempt.organizationId, targetType: 'BillingInvoice', targetId: invoice.id, requestId: context.requestId ?? null, correlationId: context.correlationId, metadataJson: { status: 'RENEWED', amountMinor: event.amountMinor.toString(), provider, externalTransactionId: event.providerPaymentId } } });
    await this.outbox.enqueue(tx, createDomainEvent({ eventType: 'billing.payment.verified', eventVersion: 1, occurredAt: new Date().toISOString(), actor: { type: 'PLATFORM' }, aggregate: { type: 'BillingPayment', id: invoice.id }, organizationId: attempt.organizationId, correlationId: context.correlationId, ...(context.requestId ? { requestId: context.requestId } : {}), dataClassification: 'CONFIDENTIAL', purpose: 'fairscale-billing-payment', payload: { invoiceId: invoice.id, amountMinor: event.amountMinor.toString(), currency: event.currency, provider, renewal: true } }));
  }

  private async reconcileReversal(tx: Prisma.TransactionClient, attempt: { id: string; billingCustomerId: string; organizationId: string; status: string; provider: string; providerPaymentId: string | null; invoiceId: string | null }, event: VerifiedBillingProviderEvent, context: EventContext, provider: string): Promise<void> {
    const payment = await tx.billingPayment.findUnique({ where: { externalTransactionId: event.providerPaymentId }, include: { invoice: true } });
    if (!payment) {
      await tx.billingPaymentAttempt.update({ where: { id: attempt.id }, data: { status: 'FAILED', failureCode: event.status } });
      return;
    }
    if (payment.organizationId !== attempt.organizationId || payment.provider !== provider || payment.amountMinor !== event.amountMinor || payment.currency.trim() !== event.currency) throw new ConflictException('Provider reversal does not match the recorded payment');
    const paymentStatus = event.status === 'CHARGEBACK' ? 'CHARGEBACK' : 'REFUNDED';
    await tx.billingPayment.update({ where: { id: payment.id }, data: { status: paymentStatus } });
    if (event.status === 'REFUNDED') await tx.billingRefund.create({ data: { id: randomUUID(), paymentId: payment.id, providerRefundId: event.providerEventId, amountMinor: event.amountMinor, currency: event.currency, status: 'SUCCEEDED', reason: 'Provider refund reconciliation' } });
    const term = await tx.billingInvoice.findUnique({ where: { id: payment.invoiceId }, select: { subscriptionTermId: true, organizationId: true } });
    if (term) {
      const termRecord = await tx.billingSubscriptionTerm.findUnique({ where: { id: term.subscriptionTermId }, select: { id: true, subscriptionId: true } });
      if (termRecord) {
        await tx.billingSubscriptionTerm.update({ where: { id: termRecord.id }, data: { status: 'SUSPENDED', nextRenewalAt: null } });
        await tx.subscription.update({ where: { id: termRecord.subscriptionId }, data: { status: 'SUSPENDED' } });
      }
    }
    await tx.billingInvoice.update({ where: { id: payment.invoiceId }, data: { status: 'UNCOLLECTIBLE', amountPaidMinor: 0n, paidAt: null } });
    await tx.auditEvent.create({ data: { id: randomUUID(), action: 'BILLING_REFUND_RECORDED', actorUserId: null, organizationId: attempt.organizationId, targetType: 'BillingPayment', targetId: payment.id, requestId: context.requestId ?? null, correlationId: context.correlationId, metadataJson: { status: paymentStatus, amountMinor: event.amountMinor.toString(), provider, externalTransactionId: event.providerPaymentId } } });
    await this.outbox.enqueue(tx, createDomainEvent({ eventType: 'billing.payment.reversed', eventVersion: 1, occurredAt: new Date().toISOString(), actor: { type: 'PLATFORM' }, aggregate: { type: 'BillingPayment', id: payment.id }, organizationId: attempt.organizationId, correlationId: context.correlationId, ...(context.requestId ? { requestId: context.requestId } : {}), dataClassification: 'CONFIDENTIAL', purpose: 'fairscale-billing-payment', payload: { invoiceId: payment.invoiceId, status: paymentStatus, amountMinor: event.amountMinor.toString(), currency: event.currency } }));
  }

  private verifyTestWebhook(eventId: string, signature: string, payload: Record<string, unknown>): VerifiedBillingProviderEvent {
    if (!eventId || !signature) throw new BadRequestException('Provider event id and signature are required');
    const secret = process.env.FAIRSCALE_BILLING_WEBHOOK_SECRET ?? 'test-fairscale-webhook-secret';
    const expected = createHmac('sha256', secret).update(JSON.stringify(payload)).digest('hex');
    const expectedBuffer = Buffer.from(expected, 'utf8');
    const suppliedBuffer = Buffer.from(signature.replace(/^sha256=/, ''), 'utf8');
    if (expectedBuffer.length !== suppliedBuffer.length || !timingSafeEqual(expectedBuffer, suppliedBuffer)) throw new UnauthorizedException('Provider signature is invalid');
    const providerPaymentId = this.stringField(payload.providerPaymentId);
    const currency = this.stringField(payload.currency);
    const amountMinor = this.bigintField(payload.amountMinor);
    const status = payload.status;
    if (!['SUCCEEDED', 'FAILED', 'REFUNDED', 'CHARGEBACK'].includes(String(status)) || currency !== 'USD') throw new BadRequestException('Provider event is invalid');
    return { providerEventId: eventId, eventType: 'payment', providerPaymentId, status: status as VerifiedBillingProviderEvent['status'], amountMinor, currency };
  }

  private stringField(value: unknown): string { if (typeof value !== 'string' || value.length === 0 || value.length > 200) throw new BadRequestException('Provider event field is invalid'); return value; }
  private bigintField(value: unknown): bigint { if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new BadRequestException('Provider amount is invalid'); return BigInt(value); }
  private hashPayload(payload: Record<string, unknown>): string { return createHash('sha256').update(JSON.stringify(payload)).digest('hex'); }
}
