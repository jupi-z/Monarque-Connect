import { randomUUID, createHash } from 'node:crypto';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type BillingPeriod } from '@prisma/client';
import { PrismaService } from '../database/prisma.service.js';
import { AuthorizationService } from '../tenancy/authorization.service.js';
import type { AuthPrincipal } from '../auth/auth.types.js';
import { PrismaOutboxWriter } from '../events/prisma-outbox.writer.js';
import { createDomainEvent } from '../events/domain-event.factory.js';
import { createRequestContext, currentEventContext } from '../events/event-context.js';
import { calculateFairScaleQuote, type FairScaleBillingPeriod, type FairScalePlanCode, type FairScalePromotion } from './fairscale-pricing.js';
import type { CreateBillingQuoteDto, EstimateBillingCapacityDto } from './billing.dto.js';

const planCodes = new Set<FairScalePlanCode>(['CONNECT', 'OPERATIONS', 'BUSINESS', 'ENTERPRISE']);
const billingPeriods = new Set<FairScaleBillingPeriod>(['MONTHLY', 'YEARLY']);
const welcomePromotion = 'WELCOME_MONTHLY15';
const annualPromotion = 'ANNUAL20';
const quoteLifetimeMs = 15 * 60 * 1000;

@Injectable()
export class BillingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorization: AuthorizationService,
    private readonly outbox: PrismaOutboxWriter,
  ) {}

  async catalog(): Promise<unknown> {
    const prices = await this.prisma.priceVersion.findMany({ where: { currency: 'USD', status: 'ACTIVE', publishedAt: { not: null } }, orderBy: [{ planCode: 'asc' }, { billingPeriod: 'asc' }], include: { components: true } });
    if (!prices.length) throw new NotFoundException('FairScale catalog is not published');
    const catalogVersion = Math.max(...prices.map((price) => price.version));
    return {
      catalogVersion,
      currency: 'USD',
      plans: prices.map((price) => ({ planCode: price.planCode, catalogVersion: price.version, billingPeriod: price.billingPeriod, currency: price.currency.trim(), baseAmountMinor: Number(price.baseAmountMinor), welcomeAmountMinor: Number(price.welcomeAmountMinor), annualDiscountAmountMinor: Number(price.annualDiscountAmountMinor), includedEstablishments: price.includedEstablishments })),
      addons: prices.flatMap((price) => price.components.filter((component) => component.code === 'ESTABLISHMENT').map((component) => ({ code: component.code, catalogVersion: price.version, billingPeriod: price.billingPeriod, currency: component.currency.trim(), amountMinor: Number(component.amountMinor), capacityUnits: component.capacityUnits }))),
      publishedAt: prices.reduce((latest, price) => price.publishedAt && price.publishedAt > latest ? price.publishedAt : latest, prices[0]!.publishedAt!).toISOString(),
    };
  }

  async createQuote(principal: AuthPrincipal, organizationId: string, input: CreateBillingQuoteDto, rawIdempotencyKey?: string): Promise<unknown> {
    const context = await this.authorization.requireMembership(principal, organizationId);
    this.authorization.assertPermission(context, 'billing:write');
    this.validateQuoteInput(input, rawIdempotencyKey);
    const idempotencyKey = rawIdempotencyKey!.trim();
    const asOf = input.asOf ? new Date(input.asOf) : new Date();
    if (Number.isNaN(asOf.getTime())) throw new BadRequestException('asOf must be a valid date');
    const payloadHash = this.hash({ planCode: input.planCode, billingPeriod: input.billingPeriod, activeEstablishmentCount: input.activeEstablishmentCount, asOf: asOf.toISOString() });
    const eventContext = currentEventContext() ?? createRequestContext();

    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.billingQuote.findUnique({ where: { organizationId_idempotencyKey: { organizationId, idempotencyKey } }, include: { lines: true } });
      if (existing) {
        if (existing.planCode !== input.planCode || existing.billingPeriod !== input.billingPeriod || existing.activeEstablishmentCount !== input.activeEstablishmentCount) throw new ConflictException('Idempotency-Key was already used with a different quote');
        return this.serializeQuote(existing);
      }
      const price = await tx.priceVersion.findFirst({ where: { planCode: input.planCode, billingPeriod: input.billingPeriod, currency: 'USD', status: 'ACTIVE', startsAt: { lte: asOf }, OR: [{ retiredAt: null }, { retiredAt: { gt: asOf } }] }, orderBy: [{ version: 'desc' }, { startsAt: 'desc' }], include: { components: true } });
      if (!price) throw new ConflictException('Requested FairScale price is not available');
      const addon = price.components.find((component) => component.code === 'ESTABLISHMENT');
      if (input.activeEstablishmentCount > price.includedEstablishments && !addon) throw new ConflictException('Requested establishment capacity is not available for this plan');
      const customer = await this.ensureBillingCustomer(tx, organizationId);
      const promotionReservation = await this.reservePromotion(tx, customer.id, input.billingPeriod);
      const promotion = promotionReservation.code;
      const amounts = calculateFairScaleQuote({ planCode: input.planCode, billingPeriod: input.billingPeriod, activeEstablishments: input.activeEstablishmentCount, price: { baseAmountMinor: price.baseAmountMinor, welcomeAmountMinor: price.welcomeAmountMinor, annualDiscountAmountMinor: price.annualDiscountAmountMinor, includedEstablishments: price.includedEstablishments, addonAmountMinor: addon?.amountMinor ?? 0n }, promotion });
      const quoteId = randomUUID();
      const quote = await tx.billingQuote.create({ data: { id: quoteId, organizationId, billingCustomerId: customer.id, priceVersionId: price.id, idempotencyKey, status: 'ISSUED', planCode: input.planCode, billingPeriod: input.billingPeriod, currency: 'USD', catalogVersion: price.version, baseAmountMinor: amounts.baseAmountMinor, discountAmountMinor: amounts.discountAmountMinor, addonAmountMinor: amounts.addonAmountMinor, totalAmountMinor: amounts.totalAmountMinor, activeEstablishmentCount: input.activeEstablishmentCount, includedEstablishments: amounts.includedEstablishments, addonEstablishments: amounts.addonEstablishments, promotionCode: promotion === 'NONE' ? null : promotion, promotionStatus: promotion === 'NONE' ? 'NONE' : promotion === 'ANNUAL20' ? 'ELIGIBLE' : 'RESERVED', expiresAt: new Date(Date.now() + quoteLifetimeMs), lines: { create: this.lines(price, amounts, input.billingPeriod) } }, include: { lines: true } });
      if (promotionReservation.redemptionId) await tx.billingPromotionRedemption.update({ where: { id: promotionReservation.redemptionId }, data: { quoteId, amountMinor: amounts.discountAmountMinor } });
      await tx.auditEvent.create({ data: { id: randomUUID(), action: 'QUOTE_CREATED', actorUserId: principal.userId, organizationId, targetType: 'BillingQuote', targetId: quote.id, requestId: eventContext.requestId ?? null, correlationId: eventContext.correlationId, metadataJson: { planCode: input.planCode, billingPeriod: input.billingPeriod, totalAmountMinor: amounts.totalAmountMinor.toString(), catalogVersion: price.version, payloadHash } } });
      await this.outbox.enqueue(tx, createDomainEvent({ eventType: 'billing.quote.created', eventVersion: 1, occurredAt: new Date().toISOString(), actor: { type: 'USER', id: principal.userId }, aggregate: { type: 'BillingQuote', id: quote.id }, organizationId, correlationId: eventContext.correlationId, ...(eventContext.requestId ? { requestId: eventContext.requestId } : {}), dataClassification: 'CONFIDENTIAL', purpose: 'fairscale-billing-quote', payload: { planCode: input.planCode, billingPeriod: input.billingPeriod, catalogVersion: price.version, totalAmountMinor: amounts.totalAmountMinor.toString() } }));
      return this.serializeQuote(quote);
    });
  }

  async getQuote(principal: AuthPrincipal, organizationId: string, quoteId: string): Promise<unknown> {
    const context = await this.authorization.requireMembership(principal, organizationId);
    this.authorization.assertPermission(context, 'billing:read');
    const quote = await this.prisma.billingQuote.findFirst({ where: { id: quoteId, organizationId }, include: { lines: true } });
    if (!quote) throw new NotFoundException('Billing quote not found');
    return this.serializeQuote(quote);
  }

  async capacity(principal: AuthPrincipal, organizationId: string): Promise<unknown> {
    const context = await this.authorization.requireMembership(principal, organizationId);
    this.authorization.assertPermission(context, 'billing:read');
    const subscription = await this.prisma.subscription.findFirst({ where: { organizationId, status: { in: ['TRIALING', 'ACTIVE', 'PAST_DUE'] }, startsAt: { lte: new Date() }, OR: [{ endsAt: null }, { endsAt: { gt: new Date() } }] }, orderBy: [{ startsAt: 'desc' }, { createdAt: 'desc' }], include: { planVersion: true } });
    if (!subscription) throw new ConflictException('Organization has no effective subscription');
    const fairScale = subscription.planVersion.planCode !== 'CONNECT' && await this.hasVerifiedFairScaleCustomer(organizationId);
    const price = fairScale ? await this.prisma.priceVersion.findFirst({ where: { planCode: subscription.planVersion.planCode, billingPeriod: 'MONTHLY', status: 'ACTIVE', currency: 'USD' }, orderBy: { version: 'desc' } }) : null;
    const legacyQuota = await this.prisma.planVersionQuota.findUnique({ where: { planVersionId_quotaCode: { planVersionId: subscription.planVersionId, quotaCode: 'MAX_ESTABLISHMENTS' } }, select: { limitValue: true } });
    if (!price && !legacyQuota) throw new ConflictException('Establishment capacity catalog is not available');
    const activeEstablishments = await this.prisma.establishment.count({ where: { organizationId, status: 'ACTIVE' } });
    const includedEstablishments = price?.includedEstablishments ?? Number(legacyQuota!.limitValue);
    return { organizationId, planCode: subscription.planVersion.planCode, includedEstablishments, activeEstablishments, addonEstablishments: 0, effectiveEstablishments: includedEstablishments, overCapacity: activeEstablishments > includedEstablishments, currency: price?.currency.trim() ?? subscription.planVersion.currency.trim() };
  }

  async estimateCapacity(principal: AuthPrincipal, organizationId: string, input: EstimateBillingCapacityDto): Promise<unknown> {
    const context = await this.authorization.requireMembership(principal, organizationId);
    this.authorization.assertPermission(context, 'billing:read');
    if (!Number.isSafeInteger(input.activeEstablishmentCount) || input.activeEstablishmentCount < 1 || !Number.isSafeInteger(input.addonEstablishmentCount) || input.addonEstablishmentCount < 0) throw new BadRequestException('Capacity counts are invalid');
    const subscription = await this.prisma.subscription.findFirst({ where: { organizationId, status: { in: ['TRIALING', 'ACTIVE', 'PAST_DUE'] } }, orderBy: { startsAt: 'desc' }, include: { planVersion: true } });
    if (!subscription) throw new ConflictException('Organization has no effective subscription');
    const fairScale = subscription.planVersion.planCode !== 'CONNECT' && await this.hasVerifiedFairScaleCustomer(organizationId);
    const price = fairScale ? await this.prisma.priceVersion.findFirst({ where: { planCode: subscription.planVersion.planCode, billingPeriod: 'MONTHLY', status: 'ACTIVE', currency: 'USD' }, orderBy: { version: 'desc' } }) : null;
    const legacyQuota = await this.prisma.planVersionQuota.findUnique({ where: { planVersionId_quotaCode: { planVersionId: subscription.planVersionId, quotaCode: 'MAX_ESTABLISHMENTS' } }, select: { limitValue: true } });
    if (!price && !legacyQuota) throw new ConflictException('Establishment capacity catalog is not available');
    const includedEstablishments = price?.includedEstablishments ?? Number(legacyQuota!.limitValue);
    const effectiveEstablishments = includedEstablishments + input.addonEstablishmentCount;
    return { organizationId, planCode: subscription.planVersion.planCode, includedEstablishments, activeEstablishments: input.activeEstablishmentCount, addonEstablishments: input.addonEstablishmentCount, effectiveEstablishments, overCapacity: input.activeEstablishmentCount > effectiveEstablishments, currency: price?.currency.trim() ?? subscription.planVersion.currency.trim() };
  }

  private async ensureBillingCustomer(tx: Prisma.TransactionClient, organizationId: string): Promise<{ id: string }> {
    await tx.$queryRaw(Prisma.sql`SELECT id FROM organizations WHERE id = ${organizationId}::uuid FOR UPDATE`);
    const linked = await tx.billingCustomerOrganization.findFirst({ where: { organizationId }, select: { billingCustomerId: true } });
    if (linked) return { id: linked.billingCustomerId };
    const organization = await tx.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { name: true } });
    const customerId = randomUUID();
    await tx.billingCustomer.create({ data: { id: customerId, identityKey: `organization:${organizationId}`, displayName: organization.name, organizations: { create: { organizationId, role: 'OWNER', evidenceJson: { source: 'organization-ownership' } } }, promotionEligibility: { create: { id: randomUUID(), promotionCode: welcomePromotion, firstEligibleAt: new Date() } } } });
    return { id: customerId };
  }

  private async reservePromotion(tx: Prisma.TransactionClient, customerId: string, period: FairScaleBillingPeriod): Promise<{ code: FairScalePromotion; redemptionId?: string }> {
    if (period === 'YEARLY') return { code: annualPromotion };
    const now = new Date();
    await tx.$queryRaw(Prisma.sql`SELECT id FROM billing_customers WHERE id = ${customerId}::uuid FOR UPDATE`);
    await tx.billingPromotionRedemption.updateMany({
      where: {
        billingCustomerId: customerId,
        promotionCode: welcomePromotion,
        billingPeriod: 'MONTHLY',
        status: 'RESERVED',
        OR: [
          { quote: { status: 'ISSUED', expiresAt: { lt: now } } },
          { quoteId: null, reservedAt: { lt: new Date(now.getTime() - quoteLifetimeMs) } },
        ],
      },
      data: { status: 'RELEASED', releasedAt: now },
    });
    const eligibility = await tx.billingPromotionEligibility.findUnique({ where: { billingCustomerId_promotionCode: { billingCustomerId: customerId, promotionCode: welcomePromotion } } });
    if (!eligibility?.eligible || eligibility.monthlyPaidCount >= 3) return { code: 'NONE' };
    const reserved = await tx.billingPromotionRedemption.count({ where: { billingCustomerId: customerId, promotionCode: welcomePromotion, billingPeriod: 'MONTHLY', status: { in: ['RESERVED', 'CONSUMED'] } } });
    if (reserved >= 3) return { code: 'NONE' };
    const sequence = reserved + 1;
    const redemptionId = randomUUID();
    await tx.billingPromotionRedemption.create({ data: { id: redemptionId, billingCustomerId: customerId, promotionCode: welcomePromotion, billingPeriod: 'MONTHLY', sequence, amountMinor: 0n, status: 'RESERVED' } });
    return { code: welcomePromotion, redemptionId };
  }

  private async hasVerifiedFairScaleCustomer(organizationId: string): Promise<boolean> {
    const link = await this.prisma.billingCustomerOrganization.findFirst({ where: { organizationId, billingCustomer: { status: 'VERIFIED' } }, select: { billingCustomerId: true } });
    return Boolean(link);
  }

  private lines(price: { baseAmountMinor: bigint }, amounts: ReturnType<typeof calculateFairScaleQuote>, period: FairScaleBillingPeriod): Prisma.BillingQuoteLineCreateWithoutQuoteInput[] {
    const lines: Prisma.BillingQuoteLineCreateWithoutQuoteInput[] = [{ id: randomUUID(), code: 'BASE_PLAN', description: `FairScale ${period.toLowerCase()} plan`, quantity: 1, unitAmountMinor: price.baseAmountMinor, discountAmountMinor: amounts.discountAmountMinor, totalAmountMinor: amounts.baseAmountMinor - amounts.discountAmountMinor, currency: 'USD' }];
    if (amounts.addonEstablishments > 0) lines.push({ id: randomUUID(), code: 'ESTABLISHMENT', description: 'Additional active establishment', quantity: amounts.addonEstablishments, unitAmountMinor: amounts.addonAmountMinor / BigInt(amounts.addonEstablishments), discountAmountMinor: 0n, totalAmountMinor: amounts.addonAmountMinor, currency: 'USD' });
    return lines;
  }

  private serializeQuote(quote: { id: string; organizationId: string; planCode: string; billingPeriod: BillingPeriod; currency: string; catalogVersion: number; baseAmountMinor: bigint; discountAmountMinor: bigint; addonAmountMinor: bigint; totalAmountMinor: bigint; activeEstablishmentCount: number; includedEstablishments: number; addonEstablishments: number; promotionCode: string | null; promotionStatus: string; expiresAt: Date; createdAt: Date; lines: Array<{ code: string; description: string; quantity: number; unitAmountMinor: bigint; discountAmountMinor: bigint; totalAmountMinor: bigint }> }): unknown {
    return { id: quote.id, organizationId: quote.organizationId, planCode: quote.planCode, billingPeriod: quote.billingPeriod, currency: quote.currency.trim(), catalogVersion: quote.catalogVersion, baseAmountMinor: Number(quote.baseAmountMinor), discountAmountMinor: Number(quote.discountAmountMinor), addonAmountMinor: Number(quote.addonAmountMinor), totalAmountMinor: Number(quote.totalAmountMinor), activeEstablishmentCount: quote.activeEstablishmentCount, includedEstablishments: quote.includedEstablishments, addonEstablishments: quote.addonEstablishments, promotionCode: quote.promotionCode, promotionStatus: quote.promotionStatus, lines: quote.lines.map((line) => ({ code: line.code, description: line.description, quantity: line.quantity, unitAmountMinor: Number(line.unitAmountMinor), discountAmountMinor: Number(line.discountAmountMinor), totalAmountMinor: Number(line.totalAmountMinor) })), expiresAt: quote.expiresAt.toISOString(), createdAt: quote.createdAt.toISOString() };
  }

  private validateQuoteInput(input: CreateBillingQuoteDto, rawKey?: string): void {
    if (!planCodes.has(input.planCode)) throw new BadRequestException('planCode is invalid');
    if (!billingPeriods.has(input.billingPeriod)) throw new BadRequestException('billingPeriod is invalid');
    if (!Number.isSafeInteger(input.activeEstablishmentCount) || input.activeEstablishmentCount < 1) throw new BadRequestException('activeEstablishmentCount is invalid');
    if (!rawKey?.trim() || rawKey.length > 200 || /[\r\n]/.test(rawKey)) throw new BadRequestException('Idempotency-Key is required and invalid');
  }

  private hash(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
}
