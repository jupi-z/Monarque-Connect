import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service.js';
import { AuthorizationService } from '../tenancy/authorization.service.js';
import type { AuthPrincipal } from '../auth/auth.types.js';
import { PrismaOutboxWriter } from '../events/prisma-outbox.writer.js';
import { createDomainEvent } from '../events/domain-event.factory.js';
import { createRequestContext, currentEventContext } from '../events/event-context.js';
import { addBillingPeriod, billingPeriodKey } from './billing-period.js';
import type { ScheduleBillingChangeDto } from './billing.dto.js';

const dunningGraceMs = 7 * 24 * 60 * 60 * 1000;
type BillingTermView = Prisma.BillingSubscriptionTermGetPayload<{ include: { addons: true; scheduledChanges: true } }>;
type BillingInvoiceView = Prisma.BillingInvoiceGetPayload<{ include: { lines: true; payments: true } }>;
type BillingScheduledChangeView = Prisma.BillingScheduledChangeGetPayload<{ select: { id: true; subscriptionTermId: true; organizationId: true; kind: true; status: true; effectiveAt: true; targetPlanCode: true; targetBillingPeriod: true; targetStateJson: true; createdAt: true; appliedAt: true; canceledAt: true } }>;

@Injectable()
export class BillingLifecycleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorization: AuthorizationService,
    private readonly outbox: PrismaOutboxWriter,
  ) {}

  async getSubscription(principal: AuthPrincipal, organizationId: string): Promise<unknown> {
    const context = await this.authorization.requireMembership(principal, organizationId);
    this.authorization.assertPermission(context, 'billing:read');
    const term = await this.prisma.billingSubscriptionTerm.findFirst({
      where: { organizationId, status: { in: ['PENDING', 'ACTIVE', 'PAST_DUE', 'SUSPENDED'] } },
      orderBy: [{ currentPeriodStart: 'desc' }, { createdAt: 'desc' }],
      include: { addons: true, scheduledChanges: { where: { status: 'PENDING' }, orderBy: { effectiveAt: 'asc' } }, subscription: { include: { planVersion: true } } },
    });
    if (!term) throw new NotFoundException('Billing subscription not found');
    return this.serializeTerm(term);
  }

  async listInvoices(principal: AuthPrincipal, organizationId: string): Promise<unknown> {
    const context = await this.authorization.requireMembership(principal, organizationId);
    this.authorization.assertPermission(context, 'billing:read');
    const invoices = await this.prisma.billingInvoice.findMany({ where: { organizationId }, orderBy: [{ issuedAt: 'desc' }, { number: 'desc' }], include: { lines: true, payments: true } });
    return invoices.map((invoice) => this.serializeInvoice(invoice));
  }

  async scheduleChange(principal: AuthPrincipal, organizationId: string, termId: string, input: ScheduleBillingChangeDto, rawIdempotencyKey?: string): Promise<unknown> {
    const context = await this.authorization.requireMembership(principal, organizationId);
    this.authorization.assertPermission(context, 'billing:write');
    const idempotencyKey = this.requireIdempotencyKey(rawIdempotencyKey);
    const eventContext = currentEventContext() ?? createRequestContext();
    const effectiveAt = input.effectiveAt ? new Date(input.effectiveAt) : null;
    if (effectiveAt && Number.isNaN(effectiveAt.getTime())) throw new BadRequestException('effectiveAt must be a valid date');

    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.billingScheduledChange.findUnique({ where: { organizationId_idempotencyKey: { organizationId, idempotencyKey } } });
      if (existing) {
        if (existing.kind !== input.kind || existing.targetPlanCode !== (input.targetPlanCode ?? null) || existing.targetBillingPeriod !== (input.targetBillingPeriod ?? null)) throw new ConflictException('Idempotency-Key was already used with a different scheduled change');
        return this.serializeScheduledChange(existing);
      }
      const term = await tx.billingSubscriptionTerm.findFirst({ where: { id: termId, organizationId, status: { in: ['ACTIVE', 'PAST_DUE'] } }, include: { subscription: true } });
      if (!term) throw new NotFoundException('Billing subscription term not found');
      const activationAt = effectiveAt ?? term.currentPeriodEnd;
      if (activationAt < term.currentPeriodEnd) throw new ConflictException('Billing changes take effect at the end of the current term');
      this.validateScheduledChange(input);
      if ((input.kind === 'PLAN_CHANGE' || input.kind === 'PERIOD_CHANGE') && activationAt.getTime() !== term.currentPeriodEnd.getTime()) throw new ConflictException('Plan and billing-period changes must be scheduled at the current term end');
      if (input.kind === 'CANCELLATION' && activationAt.getTime() !== term.currentPeriodEnd.getTime()) throw new ConflictException('Cancellation must be scheduled at the current term end');
      const change = await tx.billingScheduledChange.create({ data: { id: randomUUID(), organizationId, subscriptionTermId: term.id, idempotencyKey, kind: input.kind, status: 'PENDING', effectiveAt: activationAt, targetPlanCode: input.targetPlanCode ?? null, targetBillingPeriod: input.targetBillingPeriod ?? null, targetStateJson: { addonCode: input.addonCode ?? null, addonQuantity: input.addonQuantity ?? null }, requestedByUserId: principal.userId } });
      await tx.auditEvent.create({ data: { id: randomUUID(), action: 'BILLING_RENEWAL_SCHEDULED', actorUserId: principal.userId, organizationId, targetType: 'BillingScheduledChange', targetId: change.id, requestId: eventContext.requestId ?? null, correlationId: eventContext.correlationId, metadataJson: { kind: input.kind, effectiveAt: activationAt.toISOString(), targetPlanCode: input.targetPlanCode ?? null, targetBillingPeriod: input.targetBillingPeriod ?? null } } });
      await this.outbox.enqueue(tx, createDomainEvent({ eventType: 'billing.scheduled_change.created', eventVersion: 1, occurredAt: new Date().toISOString(), actor: { type: 'USER', id: principal.userId }, aggregate: { type: 'BillingScheduledChange', id: change.id }, organizationId, correlationId: eventContext.correlationId, ...(eventContext.requestId ? { requestId: eventContext.requestId } : {}), dataClassification: 'CONFIDENTIAL', purpose: 'fairscale-billing-lifecycle', payload: { kind: input.kind, effectiveAt: activationAt.toISOString() } }));
      return this.serializeScheduledChange(change);
    });
  }

  async cancelScheduledChange(principal: AuthPrincipal, organizationId: string, changeId: string): Promise<unknown> {
    const context = await this.authorization.requireMembership(principal, organizationId);
    this.authorization.assertPermission(context, 'billing:write');
    const eventContext = currentEventContext() ?? createRequestContext();
    return this.prisma.$transaction(async (tx) => {
      const change = await tx.billingScheduledChange.findFirst({ where: { id: changeId, organizationId, status: 'PENDING' } });
      if (!change) throw new NotFoundException('Scheduled billing change not found');
      const updated = await tx.billingScheduledChange.update({ where: { id: change.id }, data: { status: 'CANCELED', canceledAt: new Date() } });
      await tx.auditEvent.create({ data: { id: randomUUID(), action: 'BILLING_RENEWAL_SCHEDULED', actorUserId: principal.userId, organizationId, targetType: 'BillingScheduledChange', targetId: change.id, requestId: eventContext.requestId ?? null, correlationId: eventContext.correlationId, metadataJson: { status: 'CANCELED' } } });
      return this.serializeScheduledChange(updated);
    });
  }

  async applyScheduledChanges(at = new Date(), limit = 100): Promise<{ applied: number }> {
    const pending = await this.prisma.billingScheduledChange.findMany({ where: { status: 'PENDING', effectiveAt: { lte: at } }, orderBy: [{ effectiveAt: 'asc' }, { createdAt: 'asc' }], take: limit, select: { id: true } });
    let applied = 0;
    for (const candidate of pending) if (await this.applyOneScheduledChange(candidate.id, at)) applied += 1;
    return { applied };
  }

  async renewDueTerms(at = new Date(), limit = 100, provider?: 'TEST'): Promise<{ invoicesIssued: number; paymentAttemptsCreated: number }> {
    if (provider && (provider !== 'TEST' || process.env.NODE_ENV !== 'test')) throw new ConflictException('The requested billing provider is not enabled');
    await this.applyScheduledChanges(at, limit);
    const due = await this.prisma.billingSubscriptionTerm.findMany({ where: { status: 'ACTIVE', nextRenewalAt: { lte: at } }, orderBy: [{ nextRenewalAt: 'asc' }, { createdAt: 'asc' }], take: limit, select: { id: true } });
    let invoicesIssued = 0;
    let paymentAttemptsCreated = 0;
    for (const candidate of due) {
      const result = await this.issueRenewal(candidate.id, at, provider);
      invoicesIssued += result.invoice ? 1 : 0;
      paymentAttemptsCreated += result.attempt ? 1 : 0;
    }
    return { invoicesIssued, paymentAttemptsCreated };
  }

  async runDunning(at = new Date(), limit = 100): Promise<{ pastDue: number; suspended: number }> {
    const candidates = await this.prisma.billingInvoice.findMany({ where: { status: 'OPEN', dueAt: { lte: at } }, orderBy: [{ dueAt: 'asc' }, { issuedAt: 'asc' }], take: limit, select: { id: true } });
    let pastDue = 0;
    let suspended = 0;
    for (const candidate of candidates) {
      const result = await this.transitionDunning(candidate.id, at);
      pastDue += result === 'PAST_DUE' ? 1 : 0;
      suspended += result === 'SUSPENDED' ? 1 : 0;
    }
    return { pastDue, suspended };
  }

  async listPlatformTerms(): Promise<unknown> {
    return this.prisma.billingSubscriptionTerm.findMany({ orderBy: { updatedAt: 'desc' }, take: 500, select: { id: true, organizationId: true, planCode: true, billingPeriod: true, status: true, currentPeriodStart: true, currentPeriodEnd: true, nextRenewalAt: true, totalAmountMinor: true, currency: true } }).then((terms) => terms.map((term) => ({ ...term, totalAmountMinor: Number(term.totalAmountMinor), currency: term.currency.trim(), currentPeriodStart: term.currentPeriodStart.toISOString(), currentPeriodEnd: term.currentPeriodEnd.toISOString(), nextRenewalAt: term.nextRenewalAt?.toISOString() ?? null })));
  }

  async listPlatformInvoices(): Promise<unknown> {
    return this.prisma.billingInvoice.findMany({ orderBy: { issuedAt: 'desc' }, take: 500, select: { id: true, organizationId: true, number: true, status: true, currency: true, totalMinor: true, amountPaidMinor: true, issuedAt: true, dueAt: true, paidAt: true } }).then((invoices) => invoices.map((invoice) => ({ ...invoice, currency: invoice.currency.trim(), totalMinor: Number(invoice.totalMinor), amountPaidMinor: Number(invoice.amountPaidMinor), issuedAt: invoice.issuedAt.toISOString(), dueAt: invoice.dueAt.toISOString(), paidAt: invoice.paidAt?.toISOString() ?? null })));
  }

  private async issueRenewal(termId: string, at: Date, provider?: 'TEST'): Promise<{ invoice: boolean; attempt: boolean }> {
    const eventContext = currentEventContext() ?? createRequestContext();
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM billing_subscription_terms WHERE id = ${termId}::uuid FOR UPDATE`);
      const term = await tx.billingSubscriptionTerm.findUnique({ where: { id: termId }, include: { subscription: true, addons: { where: { status: 'ACTIVE' } } } });
      if (!term || term.status !== 'ACTIVE' || !term.nextRenewalAt || term.nextRenewalAt > at) return { invoice: false, attempt: false };
      const periodStart = term.currentPeriodEnd;
      const periodEnd = addBillingPeriod(periodStart, term.billingPeriod);
      const existing = await tx.billingInvoice.findUnique({ where: { subscriptionTermId_periodStart_periodEnd: { subscriptionTermId: term.id, periodStart, periodEnd } } });
      if (existing) return { invoice: false, attempt: false };
      const price = await tx.priceVersion.findFirst({ where: { planCode: term.planCode, billingPeriod: term.billingPeriod, currency: 'USD', status: 'ACTIVE' }, orderBy: { version: 'desc' }, include: { components: true } });
      if (!price) throw new ConflictException('No active price is available for billing renewal');
      const discount = term.billingPeriod === 'YEARLY' ? price.annualDiscountAmountMinor : 0n;
      const addonAmount = term.addonAmountMinor;
      const total = price.baseAmountMinor - discount + addonAmount;
      const sequence = ((await tx.billingInvoice.findFirst({ where: { subscriptionTermId: term.id }, orderBy: { sequence: 'desc' }, select: { sequence: true } }))?.sequence ?? 0) + 1;
      const rows = await tx.$queryRaw<Array<{ nextval: bigint }>>(Prisma.sql`SELECT nextval('billing_invoice_number_seq')`);
      if (rows[0]?.nextval === undefined) throw new ConflictException('Billing invoice sequence is unavailable');
      const invoice = await tx.billingInvoice.create({ data: { id: randomUUID(), billingCustomerId: term.billingCustomerId, organizationId: term.organizationId, subscriptionTermId: term.id, number: `MC-${periodStart.getUTCFullYear()}-${String(rows[0].nextval).padStart(6, '0')}`, sequence, status: 'OPEN', currency: term.currency, periodStart, periodEnd, subtotalMinor: price.baseAmountMinor + addonAmount, discountMinor: discount, totalMinor: total, amountPaidMinor: 0n, dueAt: periodStart, lines: { create: [{ id: randomUUID(), lineIndex: 0, code: 'BASE_PLAN', description: `FairScale ${term.billingPeriod.toLowerCase()} renewal`, quantity: 1, unitAmountMinor: price.baseAmountMinor, discountMinor: discount, totalMinor: price.baseAmountMinor - discount, currency: term.currency }, ...(addonAmount > 0n ? [{ id: randomUUID(), lineIndex: 1, code: 'ADDON', description: 'FairScale recurring add-on', quantity: 1, unitAmountMinor: addonAmount, discountMinor: 0n, totalMinor: addonAmount, currency: term.currency }] : [])] } } });
      let attempt = false;
      if (provider === 'TEST') {
        const id = randomUUID();
        await tx.billingPaymentAttempt.create({ data: { id, billingCustomerId: term.billingCustomerId, organizationId: term.organizationId, subscriptionTermId: term.id, invoiceId: invoice.id, idempotencyKey: billingPeriodKey(term.id, periodStart, periodEnd), provider, providerPaymentId: `test_${id}`, status: 'REQUIRES_ACTION', amountMinor: total, currency: term.currency } });
        attempt = true;
      }
      await tx.billingSubscriptionTerm.update({ where: { id: term.id }, data: { nextRenewalAt: null, baseAmountMinor: price.baseAmountMinor, discountAmountMinor: discount, addonAmountMinor: addonAmount, totalAmountMinor: total } });
      await tx.auditEvent.create({ data: { id: randomUUID(), action: 'BILLING_INVOICE_ISSUED', actorUserId: null, organizationId: term.organizationId, targetType: 'BillingInvoice', targetId: invoice.id, requestId: eventContext.requestId ?? null, correlationId: eventContext.correlationId, metadataJson: { sequence, periodStart: periodStart.toISOString(), periodEnd: periodEnd.toISOString(), totalMinor: total.toString(), paymentAttemptCreated: attempt } } });
      await this.outbox.enqueue(tx, createDomainEvent({ eventType: 'billing.invoice.issued', eventVersion: 1, occurredAt: at.toISOString(), actor: { type: 'SYSTEM' }, aggregate: { type: 'BillingInvoice', id: invoice.id }, organizationId: term.organizationId, correlationId: eventContext.correlationId, ...(eventContext.requestId ? { requestId: eventContext.requestId } : {}), dataClassification: 'CONFIDENTIAL', purpose: 'fairscale-billing-lifecycle', payload: { invoiceId: invoice.id, sequence, periodStart: periodStart.toISOString(), periodEnd: periodEnd.toISOString(), totalMinor: total.toString() } }));
      return { invoice: true, attempt };
    });
  }

  private async transitionDunning(invoiceId: string, at: Date): Promise<'PAST_DUE' | 'SUSPENDED' | null> {
    const eventContext = currentEventContext() ?? createRequestContext();
    return this.prisma.$transaction(async (tx) => {
      const invoice = await tx.billingInvoice.findUnique({ where: { id: invoiceId }, include: { subscriptionTerm: { include: { subscription: true } } } });
      if (!invoice || invoice.status !== 'OPEN') return null;
      await tx.$queryRaw(Prisma.sql`SELECT id FROM billing_subscription_terms WHERE id = ${invoice.subscriptionTermId}::uuid FOR UPDATE`);
      const term = await tx.billingSubscriptionTerm.findUniqueOrThrow({ where: { id: invoice.subscriptionTermId }, include: { subscription: true } });
      const next = at.getTime() - invoice.dueAt.getTime() > dunningGraceMs ? 'SUSPENDED' : 'PAST_DUE';
      if (term.status === next && term.subscription.status === next) return null;
      await tx.billingSubscriptionTerm.update({ where: { id: term.id }, data: { status: next, nextRenewalAt: null } });
      await tx.subscription.update({ where: { id: term.subscriptionId }, data: { status: next } });
      if (next === 'SUSPENDED') await tx.billingInvoice.update({ where: { id: invoice.id }, data: { status: 'UNCOLLECTIBLE' } });
      await tx.auditEvent.create({ data: { id: randomUUID(), action: 'BILLING_DUNNING_TRANSITIONED', actorUserId: null, organizationId: term.organizationId, targetType: 'BillingSubscriptionTerm', targetId: term.id, requestId: eventContext.requestId ?? null, correlationId: eventContext.correlationId, metadataJson: { invoiceId: invoice.id, status: next, at: at.toISOString() } } });
      await this.outbox.enqueue(tx, createDomainEvent({ eventType: 'billing.dunning.transitioned', eventVersion: 1, occurredAt: at.toISOString(), actor: { type: 'SYSTEM' }, aggregate: { type: 'BillingSubscriptionTerm', id: term.id }, organizationId: term.organizationId, correlationId: eventContext.correlationId, ...(eventContext.requestId ? { requestId: eventContext.requestId } : {}), dataClassification: 'CONFIDENTIAL', purpose: 'fairscale-billing-lifecycle', payload: { invoiceId: invoice.id, status: next } }));
      return next;
    });
  }

  private async applyOneScheduledChange(changeId: string, at: Date): Promise<boolean> {
    const eventContext = currentEventContext() ?? createRequestContext();
    return this.prisma.$transaction(async (tx) => {
      const change = await tx.billingScheduledChange.findUnique({ where: { id: changeId } });
      if (!change || change.status !== 'PENDING') return false;
      await tx.$queryRaw(Prisma.sql`SELECT id FROM billing_subscription_terms WHERE id = ${change.subscriptionTermId}::uuid FOR UPDATE`);
      const term = await tx.billingSubscriptionTerm.findUnique({ where: { id: change.subscriptionTermId }, include: { subscription: true } });
      if (!term || term.status === 'CANCELED' || term.status === 'EXPIRED') return false;
      if (change.kind === 'CANCELLATION') {
        await tx.billingSubscriptionTerm.update({ where: { id: term.id }, data: { status: 'CANCELED', canceledAt: change.effectiveAt, nextRenewalAt: null } });
        await tx.subscription.update({ where: { id: term.subscriptionId }, data: { status: 'CANCELED', canceledAt: change.effectiveAt, endsAt: change.effectiveAt } });
      } else if (change.kind === 'PLAN_CHANGE' || change.kind === 'PERIOD_CHANGE') {
        const planCode = change.targetPlanCode ?? term.planCode;
        const period = change.targetBillingPeriod ?? term.billingPeriod;
        const plan = await tx.planVersion.findFirst({ where: { planCode, billingPeriod: period, currency: 'USD', status: 'ACTIVE' }, orderBy: { version: 'desc' } });
        const price = await tx.priceVersion.findFirst({ where: { planCode, billingPeriod: period, currency: 'USD', status: 'ACTIVE' }, orderBy: { version: 'desc' } });
        if (!plan || !price) throw new ConflictException('Target billing plan is not available');
        const nextEnd = addBillingPeriod(change.effectiveAt, period);
        const total = price.baseAmountMinor - (period === 'YEARLY' ? price.annualDiscountAmountMinor : 0n) + term.addonAmountMinor;
        await tx.subscription.update({ where: { id: term.subscriptionId }, data: { planVersionId: plan.id, status: 'ACTIVE', startsAt: change.effectiveAt, endsAt: nextEnd } });
        await tx.billingSubscriptionTerm.update({ where: { id: term.id }, data: { status: 'ACTIVE', planCode, billingPeriod: period, currency: 'USD', catalogVersion: price.version, baseAmountMinor: price.baseAmountMinor, discountAmountMinor: period === 'YEARLY' ? price.annualDiscountAmountMinor : 0n, totalAmountMinor: total, currentPeriodStart: change.effectiveAt, currentPeriodEnd: nextEnd, nextRenewalAt: nextEnd } });
      } else {
        const state = this.objectState(change.targetStateJson);
        const addonCode = state.addonCode;
        const quantity = state.addonQuantity;
        if (!addonCode || quantity === null) throw new ConflictException('Addon change is incomplete');
        const existing = await tx.billingSubscriptionAddon.findFirst({ where: { subscriptionTermId: term.id, code: addonCode, startsAt: change.effectiveAt } });
        if (quantity === 0) {
          await tx.billingSubscriptionAddon.updateMany({ where: { subscriptionTermId: term.id, code: addonCode, status: 'ACTIVE' }, data: { status: 'SCHEDULED_TO_REMOVE', scheduledEndAt: change.effectiveAt } });
        } else if (!existing) {
          const price = await tx.priceVersion.findFirst({ where: { planCode: term.planCode, billingPeriod: term.billingPeriod, currency: 'USD', status: 'ACTIVE' }, orderBy: { version: 'desc' }, include: { components: true } });
          const component = price?.components.find((candidate) => candidate.code === addonCode);
          if (!component) throw new ConflictException('Addon is not available for this plan');
          await tx.billingSubscriptionAddon.create({ data: { id: randomUUID(), subscriptionTermId: term.id, organizationId: term.organizationId, code: addonCode, status: 'ACTIVE', quantity, billingPeriod: term.billingPeriod, currency: component.currency, unitAmountMinor: component.amountMinor, startsAt: change.effectiveAt } });
        }
      }
      const updated = await tx.billingScheduledChange.update({ where: { id: change.id }, data: { status: 'APPLIED', appliedAt: at } });
      await tx.auditEvent.create({ data: { id: randomUUID(), action: 'BILLING_SCHEDULED_CHANGE_APPLIED', actorUserId: null, organizationId: change.organizationId, targetType: 'BillingScheduledChange', targetId: change.id, requestId: eventContext.requestId ?? null, correlationId: eventContext.correlationId, metadataJson: { kind: change.kind, effectiveAt: change.effectiveAt.toISOString() } } });
      await this.outbox.enqueue(tx, createDomainEvent({ eventType: 'billing.scheduled_change.applied', eventVersion: 1, occurredAt: at.toISOString(), actor: { type: 'SYSTEM' }, aggregate: { type: 'BillingScheduledChange', id: updated.id }, organizationId: change.organizationId, correlationId: eventContext.correlationId, ...(eventContext.requestId ? { requestId: eventContext.requestId } : {}), dataClassification: 'CONFIDENTIAL', purpose: 'fairscale-billing-lifecycle', payload: { kind: change.kind, effectiveAt: change.effectiveAt.toISOString() } }));
      return true;
    });
  }

  private validateScheduledChange(input: ScheduleBillingChangeDto): void {
    if (input.kind === 'PLAN_CHANGE' && !input.targetPlanCode) throw new BadRequestException('targetPlanCode is required for plan changes');
    if (input.kind === 'PERIOD_CHANGE' && !input.targetBillingPeriod) throw new BadRequestException('targetBillingPeriod is required for period changes');
    if (input.kind === 'ADDON_CHANGE' && (!input.addonCode || input.addonQuantity === undefined)) throw new BadRequestException('addonCode and addonQuantity are required for addon changes');
    if (input.kind === 'CANCELLATION' && (input.targetPlanCode || input.targetBillingPeriod || input.addonCode || input.addonQuantity !== undefined)) throw new BadRequestException('Cancellation cannot carry a target');
  }

  private objectState(value: Prisma.JsonValue): { addonCode: string | null; addonQuantity: number | null } {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { addonCode: null, addonQuantity: null };
    const record = value as Record<string, unknown>;
    return { addonCode: typeof record.addonCode === 'string' ? record.addonCode : null, addonQuantity: typeof record.addonQuantity === 'number' ? record.addonQuantity : null };
  }

  private requireIdempotencyKey(value?: string): string {
    if (!value?.trim() || value.length > 200 || /[\r\n]/.test(value)) throw new BadRequestException('Idempotency-Key is required and invalid');
    return value.trim();
  }

  private serializeTerm(term: BillingTermView): unknown {
    return {
      id: term.id,
      organizationId: term.organizationId,
      planCode: term.planCode,
      billingPeriod: term.billingPeriod,
      status: term.status,
      currency: term.currency.trim(),
      currentPeriodStart: term.currentPeriodStart.toISOString(),
      currentPeriodEnd: term.currentPeriodEnd.toISOString(),
      nextRenewalAt: term.nextRenewalAt?.toISOString() ?? null,
      totalAmountMinor: Number(term.totalAmountMinor),
      addons: term.addons.map((addon) => ({ code: addon.code, quantity: addon.quantity, status: addon.status, unitAmountMinor: Number(addon.unitAmountMinor), startsAt: addon.startsAt.toISOString(), scheduledEndAt: addon.scheduledEndAt?.toISOString() ?? null })),
      scheduledChanges: term.scheduledChanges.map((change) => this.serializeScheduledChange(change)),
    };
  }

  private serializeInvoice(invoice: BillingInvoiceView): unknown {
    return {
      id: invoice.id,
      organizationId: invoice.organizationId,
      number: invoice.number,
      status: invoice.status,
      currency: invoice.currency.trim(),
      periodStart: invoice.periodStart.toISOString(),
      periodEnd: invoice.periodEnd.toISOString(),
      subtotalMinor: Number(invoice.subtotalMinor),
      discountMinor: Number(invoice.discountMinor),
      taxMinor: Number(invoice.taxMinor),
      totalMinor: Number(invoice.totalMinor),
      amountPaidMinor: Number(invoice.amountPaidMinor),
      issuedAt: invoice.issuedAt.toISOString(),
      dueAt: invoice.dueAt.toISOString(),
      paidAt: invoice.paidAt?.toISOString() ?? null,
      lines: invoice.lines.map((line) => ({ code: line.code, quantity: line.quantity, unitAmountMinor: Number(line.unitAmountMinor), discountMinor: Number(line.discountMinor), totalMinor: Number(line.totalMinor) })),
      payments: invoice.payments.map((payment) => ({ id: payment.id, status: payment.status, amountMinor: Number(payment.amountMinor), externalTransactionId: payment.externalTransactionId, receivedAt: payment.receivedAt.toISOString() })),
    };
  }

  private serializeScheduledChange(change: BillingScheduledChangeView): unknown {
    return { id: change.id, subscriptionTermId: change.subscriptionTermId, organizationId: change.organizationId, kind: change.kind, status: change.status, effectiveAt: change.effectiveAt.toISOString(), targetPlanCode: change.targetPlanCode, targetBillingPeriod: change.targetBillingPeriod, targetState: change.targetStateJson, createdAt: change.createdAt.toISOString(), appliedAt: change.appliedAt?.toISOString() ?? null, canceledAt: change.canceledAt?.toISOString() ?? null };
  }
}
