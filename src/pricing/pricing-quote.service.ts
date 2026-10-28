import { createHash, randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthPrincipal } from '../auth/auth.types.js';
import { PrismaService } from '../database/prisma.service.js';
import { createDomainEvent } from '../events/domain-event.factory.js';
import { createRequestContext, currentEventContext } from '../events/event-context.js';
import { PrismaOutboxWriter } from '../events/prisma-outbox.writer.js';
import { convertMeasureQuantity, type RationalMeasure } from '../referentials/measure-conversion.js';
import { AuthorizationService } from '../tenancy/authorization.service.js';
import { isProductCode, type ProductCode } from '../products/product-code.js';
import { calculateCommercialQuote } from './pricing-calculator.js';
import type { CreatePricingQuoteDto } from './pricing-quote.dto.js';

const QUOTE_TTL_MS = 15 * 60 * 1000;
const CALCULATION_VERSION = 'C3_PRICING_V3';
const Decimal = Prisma.Decimal.clone({ precision: 80, rounding: Prisma.Decimal.ROUND_HALF_UP });

type FxSnapshot = {
  rateId: string;
  baseCurrency: string;
  quoteCurrency: string;
  appliedRate: string;
  direction: 'DIRECT' | 'RECIPROCAL';
  sourceCode: string;
  sourceReference: string;
  observedAt: string;
  validFrom: string;
  validUntil: string;
};

type ResolvedTaxPolicy = {
  id: string;
  code: string;
  version: number;
  rate: Prisma.Decimal;
  calculationCurrency: 'SOURCE' | 'TARGET';
};

type ResolvedTaxContext = {
  versionId: string;
  version: number;
  establishmentId: string | null;
  jurisdictionCode: string;
  effectiveFrom: string;
};

type ResolvedDiscountRule = {
  id: string;
  code: string;
  version: number;
  rate: Prisma.Decimal;
  amount: string;
};

@Injectable()
export class PricingQuoteService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorization: AuthorizationService,
    private readonly outbox: PrismaOutboxWriter,
  ) {}

  async create(principal: AuthPrincipal, organizationId: string, input: CreatePricingQuoteDto, rawKey?: string): Promise<Record<string, unknown>> {
    const key = this.requireKey(rawKey);
    const productCode = this.product(input.productCode);
    const canonical = {
      productCode,
      offerId: input.offerId,
      variantId: input.variantId ?? null,
      quantity: new Decimal(input.quantity).toString(),
      unitCode: input.unitCode,
      targetCurrency: input.targetCurrency ?? null,
      establishmentId: input.establishmentId ?? null,
      channelCode: input.channelCode ?? null,
    };
    const inputHash = this.hash(canonical);
    const initialContext = await this.authorization.requireModuleForProduct(
      principal, organizationId, productCode, 'CATALOG', 'pricing:quote:create',
    );
    if (input.establishmentId) await this.authorization.assertEstablishment(initialContext, input.establishmentId);

    try {
      return await this.prisma.$transaction(async (tx) => {
        const auth = await this.authorization.requireModuleForProductInTransaction(
          tx, principal, organizationId, productCode, 'CATALOG', 'pricing:quote:create',
        );
        const replay = await tx.pricingQuote.findFirst({ where: { organizationId, idempotencyKey: key } });
        if (replay) {
          if (replay.establishmentId) await this.assertEstablishmentInTransaction(tx, auth, replay.establishmentId);
          return this.replay(replay, principal.userId, inputHash);
        }

        const lockedOffer = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM commercial_offers
          WHERE id = ${input.offerId}::uuid AND organization_id = ${organizationId}::uuid AND product_code = ${productCode}
          FOR SHARE
        `;
        if (lockedOffer.length !== 1) throw new NotFoundException('Commercial offer not found');

        const offer = await tx.commercialOffer.findFirst({
          where: { id: input.offerId, organizationId, productCode },
          include: {
            item: { select: { id: true, name: true, active: true } },
            variant: { select: { id: true, displayName: true, active: true } },
            sellUnit: true,
          },
        });
        if (!offer || offer.status !== 'ACTIVE' || !offer.item.active || offer.variant?.active === false) {
          throw new NotFoundException('Commercial offer not found');
        }
        const variantId = offer.variantId ?? input.variantId ?? null;
        if (offer.variantId && input.variantId && input.variantId !== offer.variantId) {
          throw new NotFoundException('Commercial offer not found');
        }
        if (variantId && !offer.variantId) {
          const variant = await tx.itemVariant.findFirst({
            where: { id: variantId, itemId: offer.itemId, organizationId, active: true },
            select: { id: true },
          });
          if (!variant) throw new NotFoundException('Commercial offer not found');
        }
        if (input.channelCode && input.channelCode !== offer.channelCode) throw new NotFoundException('Commercial offer not found');
        if (offer.establishmentId && input.establishmentId && input.establishmentId !== offer.establishmentId) {
          throw new NotFoundException('Commercial offer not found');
        }
        const establishmentId = offer.establishmentId ?? input.establishmentId ?? null;
        if (establishmentId) await this.assertEstablishmentInTransaction(tx, auth, establishmentId);

        const valuationAt = new Date();
        const policy = await this.resolvePolicy(tx, organizationId, productCode, valuationAt);
        const resolvedTaxes = await this.resolveTaxes(
          tx, organizationId, productCode, establishmentId, offer.taxCategoryCode, policy.taxPolicyCodes, valuationAt,
        );

        const eligiblePrices = await tx.commercialPriceVersion.findMany({
          where: {
            organizationId, productCode, offerId: offer.id,
            effectiveFrom: { lte: valuationAt },
            currencyCode: { in: policy.allowedCurrencies },
          },
          include: { currency: { select: { code: true, minorUnitDigits: true, active: true } }, priceUnit: true },
          orderBy: [{ currencyCode: 'asc' }, { effectiveFrom: 'desc' }, { version: 'desc' }, { id: 'asc' }],
        });
        const latestByCurrency = new Map<string, typeof eligiblePrices[number]>();
        for (const row of eligiblePrices) {
          if (row.currency.active && !latestByCurrency.has(row.currencyCode)) latestByCurrency.set(row.currencyCode, row);
        }
        const candidates = [...latestByCurrency.values()];
        if (!candidates.length) throw new UnprocessableEntityException('No effective commercial price is available under the active pricing policy');

        if (!input.targetCurrency && candidates.length > 1) {
          throw new UnprocessableEntityException('Target currency is required when multiple effective commercial prices are available');
        }
        const targetCurrency = input.targetCurrency ?? candidates[0]!.currencyCode;
        if (!policy.allowedCurrencies.includes(targetCurrency)) throw new UnprocessableEntityException('Requested currency is not allowed by the active pricing policy');
        let price = latestByCurrency.get(targetCurrency);
        if (!price) {
          const sourceCandidates = candidates.filter((candidate) => candidate.currencyCode !== targetCurrency);
          if (sourceCandidates.length !== 1) throw new UnprocessableEntityException('Commercial source currency is ambiguous or unavailable');
          price = sourceCandidates[0];
        }
        if (!price) throw new UnprocessableEntityException('No effective commercial price is available for the requested currency');
        if (!policy.allowedCurrencies.includes(price.currencyCode)) throw new UnprocessableEntityException('Commercial source currency is not allowed by the active pricing policy');

        const inputUnit = await tx.measureUnit.findFirst({ where: { code: input.unitCode, active: true } });
        if (!inputUnit || !price.priceUnit.active || inputUnit.dimension !== price.priceUnit.dimension || inputUnit.baseUnitCode !== price.priceUnit.baseUnitCode) {
          throw new UnprocessableEntityException('Requested unit is inactive or dimensionally incompatible with the published price');
        }
        const baseUnit = await tx.measureUnit.findFirst({ where: { code: inputUnit.baseUnitCode, active: true } });
        if (!baseUnit || baseUnit.dimension !== inputUnit.dimension || baseUnit.baseUnitCode !== inputUnit.baseUnitCode) {
          throw new UnprocessableEntityException('The measurement registry base unit is unavailable or inconsistent');
        }
        const [sourceCurrency, targetCurrencyDefinition] = await Promise.all([
          tx.currencyDefinition.findFirst({ where: { code: price.currencyCode, active: true } }),
          tx.currencyDefinition.findFirst({ where: { code: targetCurrency, active: true } }),
        ]);
        if (!sourceCurrency || !targetCurrencyDefinition) throw new UnprocessableEntityException('A requested currency is not active in the currency registry');

        const fx = price.currencyCode === targetCurrency
          ? null
          : await this.resolveFx(tx, price.currencyCode, targetCurrency, valuationAt, policy.maxFxAgeSeconds, policy.allowedFxSources);
        const calculationInput = {
          quantity: canonical.quantity,
          inputUnit: this.rational(inputUnit),
          priceUnit: this.rational(price.priceUnit),
          unitPrice: price.amount.toFixed(8).replace(/0+$/, '').replace(/\.$/, ''),
          sourceCurrencyCode: price.currencyCode,
          targetCurrencyCode: targetCurrency,
          sourceCurrencyDigits: sourceCurrency.minorUnitDigits,
          targetCurrencyDigits: targetCurrencyDefinition.minorUnitDigits,
          ...(fx ? {
            fxRate: fx.appliedRate,
            fxBaseCurrencyCode: price.currencyCode,
            fxQuoteCurrencyCode: targetCurrency,
          } : {}),
        };
        const grossCalculation = calculateCommercialQuote({ ...calculationInput, discounts: [], taxes: [] });
        const resolvedDiscounts = await this.resolveDiscounts(
          tx, organizationId, productCode, policy.discountRuleCodes, valuationAt,
          sourceCurrency.minorUnitDigits, grossCalculation.sourceSubtotal,
        );
        const calculation = calculateCommercialQuote({
          ...calculationInput,
          discounts: resolvedDiscounts.map((discount) => ({ code: discount.code, amount: discount.amount })),
          taxes: resolvedTaxes.policies.map((tax) => ({
            code: tax.code, version: tax.version, rate: tax.rate.toFixed(18), calculationCurrency: tax.calculationCurrency,
          })),
        });

        const expiryCandidates = [new Date(valuationAt.getTime() + QUOTE_TTL_MS)];
        const [nextPrice, nextPolicy] = await Promise.all([
          tx.commercialPriceVersion.findFirst({ where: { organizationId, offerId: offer.id, currencyCode: price.currencyCode, effectiveFrom: { gt: valuationAt } }, orderBy: { effectiveFrom: 'asc' }, select: { effectiveFrom: true } }),
          tx.pricingPolicyVersion.findFirst({ where: { organizationId, productCode, effectiveFrom: { gt: valuationAt } }, orderBy: { effectiveFrom: 'asc' }, select: { effectiveFrom: true } }),
        ]);
        if (nextPrice) expiryCandidates.push(nextPrice.effectiveFrom);
        if (nextPolicy) expiryCandidates.push(nextPolicy.effectiveFrom);
        if (policy.discountRuleCodes.length) {
          const nextDiscountRule = await tx.commercialDiscountRuleVersion.findFirst({
            where: { organizationId, productCode, code: { in: policy.discountRuleCodes }, effectiveFrom: { gt: valuationAt } },
            orderBy: { effectiveFrom: 'asc' }, select: { effectiveFrom: true },
          });
          if (nextDiscountRule) expiryCandidates.push(nextDiscountRule.effectiveFrom);
        }
        if (policy.taxPolicyCodes.length) {
          const contextScopes = establishmentId && resolvedTaxes.context?.establishmentId === establishmentId
            ? [establishmentId]
            : establishmentId ? [establishmentId, null] : [null];
          const nextTaxContext = await tx.pricingTaxContextVersion.findFirst({
            where: {
              organizationId, productCode, effectiveFrom: { gt: valuationAt },
              OR: contextScopes.map((scope) => ({ establishmentId: scope })),
            },
            orderBy: { effectiveFrom: 'asc' }, select: { effectiveFrom: true },
          });
          const nextTaxPolicy = await tx.taxPolicyVersion.findFirst({
            where: { organizationId, productCode, code: { in: policy.taxPolicyCodes }, effectiveFrom: { gt: valuationAt } },
            orderBy: [{ effectiveFrom: 'asc' }, { code: 'asc' }, { version: 'asc' }],
            select: { effectiveFrom: true },
          });
          if (nextTaxContext) expiryCandidates.push(nextTaxContext.effectiveFrom);
          if (nextTaxPolicy) expiryCandidates.push(nextTaxPolicy.effectiveFrom);
        }
        if (fx) expiryCandidates.push(new Date(fx.validUntil));
        const expiresAt = expiryCandidates.reduce((earliest, value) => value < earliest ? value : earliest);
        if (expiresAt <= valuationAt) throw new UnprocessableEntityException('The resolved pricing inputs do not remain valid for a positive quote interval');

        const id = randomUUID();
        const createdAt = new Date();
        const ratio = this.unitRatio(inputUnit, baseUnit);
        const normalizedQuantity = convertMeasureQuantity(canonical.quantity, this.rational(inputUnit), this.rational(baseUnit));
        const taxMode = resolvedTaxes.policies[0]?.calculationCurrency ?? 'SOURCE';
        const taxLines = calculation.taxes.map((line) => {
          const policyVersion = resolvedTaxes.policies.find((candidate) => candidate.code === line.code && candidate.version === line.version);
          if (!policyVersion) throw new UnprocessableEntityException('A resolved tax line has no immutable policy version');
          return {
            policyVersionId: policyVersion.id,
            code: line.code,
            version: line.version,
            calculationCurrency: line.calculationCurrency,
            rate: policyVersion.rate.toFixed(18),
            taxableBase: line.taxableBase,
            amount: line.amount,
            currencyCode: line.currencyCode,
          };
        });
        const snapshot = {
          id,
          snapshotVersion: 3,
          calculationVersion: CALCULATION_VERSION,
          createdAt: createdAt.toISOString(),
          valuationAt: valuationAt.toISOString(),
          expiresAt: expiresAt.toISOString(),
          organizationId,
          productCode,
          establishmentId,
          channelCode: offer.channelCode ?? input.channelCode ?? null,
          offerId: offer.id,
          variantId,
          priceVersionId: price.id,
          pricingPolicyVersionId: policy.id,
          inputHash,
          quantityOriginal: { amount: canonical.quantity, unitCode: input.unitCode },
          quantityNormalized: {
            amount: normalizedQuantity,
            baseUnitCode: baseUnit.code,
            conversionNumerator: ratio.numerator.toString(),
            conversionDenominator: ratio.denominator.toString(),
            unitRegistryVersion: `input-${inputUnit.registryVersion};base-${baseUnit.registryVersion};price-${price.priceUnit.registryVersion}`,
          },
          unitPrice: { amount: price.amount.toFixed(8), currencyCode: price.currencyCode, unitCode: price.priceUnitCode },
          subtotal: calculation.sourceSubtotal,
          netAmount: calculation.sourceNetAmount,
          discountAmount: calculation.discountAmount,
          discounts: resolvedDiscounts.map((discount) => ({
            ruleVersionId: discount.id, ruleCode: discount.code, version: discount.version,
            rate: discount.rate.toFixed(18), amount: discount.amount, currencyCode: price!.currencyCode,
          })),
          taxCategoryCode: resolvedTaxes.taxCategoryCode,
          taxContext: resolvedTaxes.context,
          taxLines,
          taxPolicyVersionIds: resolvedTaxes.policies.map((tax) => tax.id),
          sourceTotal: calculation.sourceTotal,
          sourceCurrency: price.currencyCode,
          targetTotal: calculation.targetTotal,
          targetCurrency,
          roundingPolicyVersion: `${policy.code}:v${policy.version}:${policy.roundingMode}`,
          taxCalculationCurrency: taxMode,
          fx,
          validity: 'VALID',
        };
        const context = currentEventContext() ?? createRequestContext();
        await tx.pricingQuote.create({
          data: {
            id, organizationId, productCode, establishmentId, offerId: offer.id, itemId: offer.itemId, variantId,
            priceVersionId: price.id, pricingPolicyVersionId: policy.id, actorUserId: principal.userId,
            idempotencyKey: key, inputHash, valuationAt, expiresAt, snapshotVersion: 3,
            calculationVersion: CALCULATION_VERSION, snapshotJson: snapshot,
            lines: {
              create: [{
                id: randomUUID(), lineIndex: 0,
                snapshotJson: {
                  itemId: offer.itemId, itemName: offer.item.name, offerId: offer.id, variantId,
                  quantityOriginal: snapshot.quantityOriginal, quantityNormalized: snapshot.quantityNormalized,
                  unitPrice: snapshot.unitPrice, subtotal: snapshot.subtotal,
                },
              }],
            },
          },
        });
        await tx.auditEvent.create({ data: {
          id: randomUUID(), action: 'PRICING_QUOTE_CREATED', actorUserId: principal.userId, organizationId, establishmentId,
          targetType: 'PricingQuote', targetId: id, requestId: context.requestId ?? null, correlationId: context.correlationId,
          metadataJson: { productCode, offerId: offer.id, inputHash },
        } });
        await this.outbox.enqueue(tx, createDomainEvent({
          eventType: 'pricing.quote.created', eventVersion: 1, occurredAt: createdAt.toISOString(),
          actor: { type: 'USER', id: principal.userId }, aggregate: { type: 'PricingQuote', id }, organizationId,
          ...(establishmentId ? { establishmentId } : {}), correlationId: context.correlationId,
          ...(context.requestId ? { requestId: context.requestId } : {}), dataClassification: 'CONFIDENTIAL',
          purpose: 'commercial-pricing-quote', payload: { quoteId: id, productCode, offerId: offer.id, inputHash },
        }));
        return snapshot;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (this.isUniqueViolation(error)) return this.resolveConcurrentReplay(principal, organizationId, productCode, key, inputHash);
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
        return this.resolveConcurrentReplay(principal, organizationId, productCode, key, inputHash);
      }
      throw error;
    }
  }

  async get(principal: AuthPrincipal, organizationId: string, quoteId: string, productCodeInput: string): Promise<Record<string, unknown>> {
    const productCode = this.product(productCodeInput);
    const context = await this.authorization.requireModuleForProduct(principal, organizationId, productCode, 'CATALOG', 'pricing:quote:read');
    const quote = await this.prisma.pricingQuote.findFirst({ where: { id: quoteId, organizationId, productCode } });
    if (!quote) throw new NotFoundException('Pricing quote not found');
    if (quote.establishmentId) await this.authorization.assertEstablishment(context, quote.establishmentId);
    const snapshot = quote.snapshotJson as Record<string, unknown>;
    return { ...snapshot, validity: new Date() < quote.expiresAt ? 'VALID' : 'EXPIRED' };
  }

  private async resolvePolicy(tx: Prisma.TransactionClient, organizationId: string, productCode: ProductCode, at: Date) {
    const versions = await tx.pricingPolicyVersion.findMany({
      where: { organizationId, productCode, effectiveFrom: { lte: at } },
      orderBy: [{ effectiveFrom: 'desc' }, { version: 'desc' }, { code: 'asc' }],
    });
    const policy = versions[0];
    if (!policy) throw new UnprocessableEntityException('An effective pricing policy must be configured for the product');
    if (versions.some((version) => version.effectiveFrom.getTime() === policy.effectiveFrom.getTime() && version.code !== policy.code)) {
      throw new UnprocessableEntityException('Multiple pricing policies are effective at the same instant');
    }
    if (policy.roundingMode !== 'HALF_UP') throw new UnprocessableEntityException('The active rounding policy is unsupported');
    if (!policy.allowedCurrencies.length) throw new UnprocessableEntityException('The active pricing policy allows no commercial currencies');
    return policy;
  }

  private async resolveDiscounts(
    tx: Prisma.TransactionClient,
    organizationId: string,
    productCode: ProductCode,
    codes: string[],
    at: Date,
    currencyDigits: number,
    grossSubtotal: string,
  ): Promise<ResolvedDiscountRule[]> {
    if (!codes.length) return [];
    const versions = await tx.commercialDiscountRuleVersion.findMany({
      where: { organizationId, productCode, code: { in: codes }, effectiveFrom: { lte: at } },
      orderBy: [{ code: 'asc' }, { effectiveFrom: 'desc' }, { version: 'desc' }],
    });
    const latestByCode = new Map<string, typeof versions[number]>();
    for (const version of versions) if (!latestByCode.has(version.code)) latestByCode.set(version.code, version);
    const unresolved = codes.filter((code) => !latestByCode.has(code));
    if (unresolved.length) throw new UnprocessableEntityException('Every configured discount rule must have an effective tenant/product-scoped version');

    const resolved = codes.slice().sort().map((code) => latestByCode.get(code)!);
    const totalRate = resolved.reduce((sum, rule) => sum.plus(rule.rate), new Decimal(0));
    if (totalRate.gt(100)) throw new UnprocessableEntityException('Configured percentage discount rates cannot exceed 100 percent in total');

    const subtotal = new Decimal(grossSubtotal);
    const discounts = resolved.map((rule) => ({
      id: rule.id,
      code: rule.code,
      version: rule.version,
      rate: rule.rate,
      amount: subtotal.mul(rule.rate).div(100).toDecimalPlaces(currencyDigits, Decimal.ROUND_HALF_UP).toFixed(currencyDigits),
    }));
    const totalAmount = discounts.reduce((sum, discount) => sum.plus(discount.amount), new Decimal(0));
    if (totalAmount.gt(subtotal)) throw new UnprocessableEntityException('Rounded discount amounts cannot exceed the source subtotal');
    return discounts;
  }

  private async resolveTaxes(
    tx: Prisma.TransactionClient,
    organizationId: string,
    productCode: ProductCode,
    establishmentId: string | null,
    taxCategoryCode: string | null,
    policyCodes: string[],
    at: Date,
  ): Promise<{ context: ResolvedTaxContext | null; taxCategoryCode: string | null; policies: ResolvedTaxPolicy[] }> {
    if (!policyCodes.length) return { context: null, taxCategoryCode, policies: [] };
    if (!taxCategoryCode) throw new UnprocessableEntityException('Tax calculation requires an explicitly classified commercial offer');

    const scope = { organizationId, productCode, status: 'ACTIVE' as const, effectiveFrom: { lte: at } };
    const establishmentContext = establishmentId
      ? await tx.pricingTaxContextVersion.findFirst({
        where: { ...scope, establishmentId }, orderBy: [{ effectiveFrom: 'desc' }, { version: 'desc' }],
      })
      : null;
    const defaultContext = establishmentContext ? null : await tx.pricingTaxContextVersion.findFirst({
      where: { ...scope, establishmentId: null }, orderBy: [{ effectiveFrom: 'desc' }, { version: 'desc' }],
    });
    const contextVersion = establishmentContext ?? defaultContext;
    if (!contextVersion) throw new UnprocessableEntityException('Tax calculation requires an effective organization or establishment tax context');

    const candidates = await tx.taxPolicyVersion.findMany({
      where: { organizationId, productCode, code: { in: policyCodes }, status: 'ACTIVE', effectiveFrom: { lte: at } },
      orderBy: [{ code: 'asc' }, { effectiveFrom: 'desc' }, { version: 'desc' }],
    });
    const latestByCode = new Map<string, typeof candidates[number]>();
    for (const candidate of candidates) if (!latestByCode.has(candidate.code)) latestByCode.set(candidate.code, candidate);
    const matchingPolicies = [...latestByCode.values()]
      .filter((candidate) => candidate.jurisdictionCode === contextVersion.jurisdictionCode && candidate.taxCategoryCode === taxCategoryCode)
      .sort((left, right) => left.code.localeCompare(right.code));
    if (!matchingPolicies.length) {
      throw new UnprocessableEntityException('No active tax policy matches the resolved tenant context and offer classification');
    }
    const calculationCurrencies = new Set(matchingPolicies.map((candidate) => candidate.calculationCurrency));
    if (calculationCurrencies.size !== 1) {
      throw new UnprocessableEntityException('SOURCE and TARGET tax policies cannot be mixed in one quote');
    }

    return {
      context: {
        versionId: contextVersion.id,
        version: contextVersion.version,
        establishmentId: contextVersion.establishmentId,
        jurisdictionCode: contextVersion.jurisdictionCode,
        effectiveFrom: contextVersion.effectiveFrom.toISOString(),
      },
      taxCategoryCode,
      policies: matchingPolicies.map((candidate) => ({
        id: candidate.id, code: candidate.code, version: candidate.version,
        rate: candidate.rate, calculationCurrency: candidate.calculationCurrency,
      })),
    };
  }

  private async resolveFx(
    tx: Prisma.TransactionClient,
    sourceCurrency: string,
    targetCurrency: string,
    at: Date,
    maxAgeSeconds: number,
    allowedSources: string[],
  ): Promise<FxSnapshot> {
    if (!allowedSources.length) throw new UnprocessableEntityException('No approved FX source is configured for the active pricing policy');
    const freshness = new Date(at.getTime() - maxAgeSeconds * 1000);
    const baseWhere = { sourceCode: { in: allowedSources }, observedAt: { gte: freshness, lte: at }, validFrom: { lte: at }, validUntil: { gt: at } };
    const direct = await tx.fxRate.findFirst({
      where: { ...baseWhere, baseCurrencyCode: sourceCurrency, quoteCurrencyCode: targetCurrency },
      orderBy: [{ observedAt: 'desc' }, { validFrom: 'desc' }, { id: 'asc' }],
    });
    if (direct) return this.serializeFx(direct, direct.rate.toFixed(18), 'DIRECT');
    const inverse = await tx.fxRate.findFirst({
      where: { ...baseWhere, baseCurrencyCode: targetCurrency, quoteCurrencyCode: sourceCurrency },
      orderBy: [{ observedAt: 'desc' }, { validFrom: 'desc' }, { id: 'asc' }],
    });
    if (!inverse) throw new UnprocessableEntityException('No fresh, approved FX rate is available for the requested currency pair');
    const appliedRate = new Decimal(1).div(inverse.rate).toDecimalPlaces(18, Decimal.ROUND_HALF_UP).toFixed(18);
    if (!new Decimal(appliedRate).gt(0)) throw new UnprocessableEntityException('The reciprocal FX rate is outside the supported precision');
    return this.serializeFx(inverse, appliedRate, 'RECIPROCAL');
  }

  private serializeFx(rate: {
    id: string; baseCurrencyCode: string; quoteCurrencyCode: string; sourceCode: string; sourceReference: string;
    observedAt: Date; validFrom: Date; validUntil: Date;
  }, appliedRate: string, direction: 'DIRECT' | 'RECIPROCAL'): FxSnapshot {
    return {
      rateId: rate.id, baseCurrency: rate.baseCurrencyCode, quoteCurrency: rate.quoteCurrencyCode, appliedRate, direction,
      sourceCode: rate.sourceCode, sourceReference: rate.sourceReference, observedAt: rate.observedAt.toISOString(),
      validFrom: rate.validFrom.toISOString(), validUntil: rate.validUntil.toISOString(),
    };
  }

  private async assertEstablishmentInTransaction(tx: Prisma.TransactionClient, context: { organizationId: string; scopeMode: string; establishmentIds: readonly string[] }, establishmentId: string): Promise<void> {
    const establishment = await tx.establishment.findFirst({ where: { id: establishmentId, organizationId: context.organizationId, status: 'ACTIVE' }, select: { id: true } });
    if (!establishment || (context.scopeMode === 'SELECTED_ESTABLISHMENTS' && !context.establishmentIds.includes(establishmentId))) {
      throw new NotFoundException('Commercial offer not found');
    }
  }

  private async resolveConcurrentReplay(principal: AuthPrincipal, organizationId: string, productCode: ProductCode, key: string, inputHash: string): Promise<Record<string, unknown>> {
    const quote = await this.prisma.pricingQuote.findFirst({ where: { organizationId, idempotencyKey: key } });
    if (!quote) throw new ConflictException('Concurrent pricing quote creation conflicted; retry with a new idempotency key');
    const authorized = await this.authorization.requireModuleForProduct(principal, organizationId, productCode, 'CATALOG', 'pricing:quote:create');
    if (quote.productCode !== productCode || quote.actorUserId !== principal.userId || quote.inputHash !== inputHash) {
      throw new ConflictException('Idempotency-Key was already used for a different pricing quote command');
    }
    if (quote.establishmentId) await this.authorization.assertEstablishment(authorized, quote.establishmentId);
    return this.withCurrentValidity(quote.snapshotJson as Record<string, unknown>, quote.expiresAt);
  }

  private replay(quote: { productCode: string; actorUserId: string; inputHash: string; snapshotJson: Prisma.JsonValue; expiresAt: Date }, actorUserId: string, inputHash: string): Record<string, unknown> {
    if (quote.actorUserId !== actorUserId || quote.inputHash !== inputHash) {
      throw new ConflictException('Idempotency-Key was already used for a different pricing quote command');
    }
    return this.withCurrentValidity(quote.snapshotJson as Record<string, unknown>, quote.expiresAt);
  }

  private withCurrentValidity(snapshot: Record<string, unknown>, expiresAt: Date): Record<string, unknown> {
    return { ...snapshot, validity: new Date() < expiresAt ? 'VALID' : 'EXPIRED' };
  }

  private rational(unit: { code: string; dimension: string; baseUnitCode: string; numerator: bigint; denominator: bigint }): RationalMeasure {
    return { code: unit.code, dimension: unit.dimension, baseUnitCode: unit.baseUnitCode, numerator: unit.numerator, denominator: unit.denominator };
  }

  private unitRatio(from: { numerator: bigint; denominator: bigint }, base: { numerator: bigint; denominator: bigint }): { numerator: bigint; denominator: bigint } {
    const numerator = from.numerator * base.denominator;
    const denominator = from.denominator * base.numerator;
    const divisor = this.gcd(numerator, denominator);
    return { numerator: numerator / divisor, denominator: denominator / divisor };
  }

  private gcd(left: bigint, right: bigint): bigint {
    let a = left < 0n ? -left : left;
    let b = right < 0n ? -right : right;
    while (b !== 0n) [a, b] = [b, a % b];
    return a || 1n;
  }

  private product(value: string): ProductCode {
    if (!isProductCode(value)) throw new BadRequestException('productCode is invalid');
    return value;
  }

  private requireKey(value?: string): string {
    const key = value?.trim();
    if (!key || key.length < 16 || key.length > 200 || /[\r\n]/.test(key)) throw new BadRequestException('Idempotency-Key must contain 16 to 200 characters');
    return key;
  }

  private hash(value: unknown): string {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
  }

  private isUniqueViolation(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
  }
}
