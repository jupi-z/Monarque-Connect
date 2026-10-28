import { createHash, randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, type AuditAction, type TaxCalculationCurrency, type TaxPolicyStatus } from '@prisma/client';
import type { AuthPrincipal } from '../auth/auth.types.js';
import { PrismaService } from '../database/prisma.service.js';
import { createDomainEvent } from '../events/domain-event.factory.js';
import { createRequestContext, currentEventContext } from '../events/event-context.js';
import { PrismaOutboxWriter } from '../events/prisma-outbox.writer.js';
import { AuthorizationService } from '../tenancy/authorization.service.js';
import { isProductCode, type ProductCode } from '../products/product-code.js';
import type { ActivateTaxPolicyVersionDto, CreatePricingPolicyVersionDto, CreateTaxPolicyVersionDto } from './pricing-policy.dto.js';

const POLICY_CREATE = 'PRICING_POLICY_VERSION_CREATE';
const TAX_POLICY_CREATE = 'TAX_POLICY_VERSION_CREATE';
const TAX_POLICY_ACTIVATE = 'TAX_POLICY_VERSION_ACTIVATE';
const CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/;
const SOURCE_PATTERN = /^[A-Z][A-Z0-9._-]{0,63}$/;

@Injectable()
export class PricingPolicyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorization: AuthorizationService,
    private readonly config: ConfigService,
    private readonly outbox: PrismaOutboxWriter,
  ) {}

  async createPricingPolicyVersion(principal: AuthPrincipal, organizationId: string, input: CreatePricingPolicyVersionDto, rawKey?: string): Promise<unknown> {
    const productCode = this.product(input.productCode);
    const key = this.requireKey(rawKey);
    const commandTime = new Date();
    const effectiveFrom = this.effectiveFrom(input.effectiveFrom, commandTime);
    if (input.effectiveFrom !== undefined && effectiveFrom <= commandTime) throw new BadRequestException('effectiveFrom must be in the future');

    const allowedCurrencies = this.canonicalList(input.allowedCurrencies ?? [], /^[A-Z]{3}$/);
    const allowedFxSources = this.canonicalList(input.allowedFxSources ?? [], SOURCE_PATTERN);
    const discountRuleCodes = this.canonicalList(input.discountRuleCodes ?? [], CODE_PATTERN);
    const taxPolicyCodes = this.canonicalList(input.taxPolicyCodes ?? [], CODE_PATTERN);
    const normalized = {
      productCode, code: input.code, effectiveFrom: input.effectiveFrom === undefined ? null : effectiveFrom.toISOString(), roundingMode: input.roundingMode,
      maxFxAgeSeconds: input.maxFxAgeSeconds, allowedCurrencies, allowedFxSources, discountRuleCodes, taxPolicyCodes,
    };
    const payloadHash = this.hash(normalized);
    const context = currentEventContext() ?? createRequestContext();
    await this.authorization.requireModuleForProduct(principal, organizationId, productCode, 'CATALOG', 'pricing:policy:manage');

    try {
      return await this.prisma.$transaction(async (tx) => {
        const auth = await this.authorization.requireModuleForProductInTransaction(tx, principal, organizationId, productCode, 'CATALOG', 'pricing:policy:manage');
        await this.lockVersionScope(tx, 'pricing-policy', organizationId, productCode, input.code);
        const replay = await this.receipt(tx, principal.userId, organizationId, POLICY_CREATE, key, payloadHash, 'PricingPolicyVersion');
        if (replay) {
          const prior = await tx.pricingPolicyVersion.findFirst({ where: { id: replay.resourceId, organizationId, productCode } });
          if (!prior) throw new ConflictException('Idempotent pricing policy version is no longer available');
          return this.serializePricingPolicy(prior);
        }

        await this.assertConfigurationReferences(tx, organizationId, productCode, allowedCurrencies, allowedFxSources, taxPolicyCodes);
        const latest = await tx.pricingPolicyVersion.findFirst({ where: { organizationId, productCode, code: input.code }, orderBy: { version: 'desc' }, select: { version: true, effectiveFrom: true } });
        if (latest && effectiveFrom <= latest.effectiveFrom) throw new ConflictException('Pricing policy versions must have strictly increasing effective times');

        const policy = await tx.pricingPolicyVersion.create({ data: {
          id: randomUUID(), organizationId, productCode, code: input.code, version: (latest?.version ?? 0) + 1,
          effectiveFrom, roundingMode: input.roundingMode, calculationScale: 18, maxFxAgeSeconds: input.maxFxAgeSeconds,
          allowedCurrencies, allowedFxSources, discountRuleCodes, taxPolicyCodes, createdByUserId: principal.userId, commandPayloadHash: payloadHash,
        } });
        await this.writeReceipt(tx, principal.userId, organizationId, POLICY_CREATE, key, payloadHash, 'PricingPolicyVersion', policy.id);
        await this.recordMutation(tx, auth, principal, organizationId, 'PRICING_POLICY_VERSION_CREATED', 'pricing.policy_version.created', 'PricingPolicyVersion', policy.id, context, {
          productCode, code: policy.code, version: policy.version, commandPayloadHash: payloadHash,
        });
        return this.serializePricingPolicy(policy);
      }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    } catch (error) {
      if (this.isUniqueViolation(error)) return this.resolveCreateReplay(principal, organizationId, productCode, POLICY_CREATE, key, payloadHash, 'PricingPolicyVersion');
      throw error;
    }
  }

  async createTaxPolicyVersion(principal: AuthPrincipal, organizationId: string, input: CreateTaxPolicyVersionDto, rawKey?: string): Promise<unknown> {
    const productCode = this.product(input.productCode);
    const key = this.requireKey(rawKey);
    const commandTime = new Date();
    const effectiveFrom = this.effectiveFrom(input.effectiveFrom, commandTime);
    if (input.effectiveFrom !== undefined && effectiveFrom <= commandTime) throw new BadRequestException('effectiveFrom must be in the future');
    const rate = this.nonNegativeRate(input.rate);
    const jurisdictionCode = input.jurisdictionCode.trim();
    const taxCategoryCode = input.taxCategoryCode.trim();
    const configurationReference = input.configurationReference.trim();
    if (!jurisdictionCode || !taxCategoryCode || !configurationReference) throw new BadRequestException('Tax policy classification and configuration reference are required');
    const normalized = {
      productCode, code: input.code, jurisdictionCode, taxCategoryCode, rate, calculationCurrency: input.calculationCurrency,
      effectiveFrom: input.effectiveFrom === undefined ? null : effectiveFrom.toISOString(), configurationReference,
    };
    const payloadHash = this.hash(normalized);
    const context = currentEventContext() ?? createRequestContext();
    await this.authorization.requireModuleForProduct(principal, organizationId, productCode, 'CATALOG', 'pricing:tax:manage');

    try {
      return await this.prisma.$transaction(async (tx) => {
        const auth = await this.authorization.requireModuleForProductInTransaction(tx, principal, organizationId, productCode, 'CATALOG', 'pricing:tax:manage');
        await this.lockVersionScope(tx, 'tax-policy', organizationId, productCode, input.code);
        const replay = await this.receipt(tx, principal.userId, organizationId, TAX_POLICY_CREATE, key, payloadHash, 'TaxPolicyVersion');
        if (replay) {
          const prior = await tx.taxPolicyVersion.findFirst({ where: { id: replay.resourceId, organizationId, productCode } });
          if (!prior) throw new ConflictException('Idempotent tax policy version is no longer available');
          return this.serializeTaxPolicy(prior);
        }

        const latest = await tx.taxPolicyVersion.findFirst({ where: { organizationId, productCode, code: input.code }, orderBy: { version: 'desc' }, select: { version: true, effectiveFrom: true } });
        if (latest && effectiveFrom <= latest.effectiveFrom) throw new ConflictException('Tax policy versions must have strictly increasing effective times');

        const policy = await tx.taxPolicyVersion.create({ data: {
          id: randomUUID(), organizationId, productCode, code: input.code, version: (latest?.version ?? 0) + 1,
          status: 'DRAFT', jurisdictionCode, taxCategoryCode, rate: new Prisma.Decimal(rate),
          calculationCurrency: input.calculationCurrency, effectiveFrom, configurationReference,
          createdByUserId: principal.userId, commandPayloadHash: payloadHash,
        } });
        await this.writeReceipt(tx, principal.userId, organizationId, TAX_POLICY_CREATE, key, payloadHash, 'TaxPolicyVersion', policy.id);
        await this.recordMutation(tx, auth, principal, organizationId, 'PRICING_TAX_POLICY_DRAFT_CREATED', 'pricing.tax_policy_version.draft_created', 'TaxPolicyVersion', policy.id, context, {
          productCode, code: policy.code, version: policy.version, commandPayloadHash: payloadHash,
        });
        return this.serializeTaxPolicy(policy);
      }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    } catch (error) {
      if (this.isUniqueViolation(error)) return this.resolveCreateReplay(principal, organizationId, productCode, TAX_POLICY_CREATE, key, payloadHash, 'TaxPolicyVersion');
      throw error;
    }
  }

  async activateTaxPolicyVersion(
    principal: AuthPrincipal,
    organizationId: string,
    taxPolicyVersionId: string,
    productCodeInput: string,
    input: ActivateTaxPolicyVersionDto,
    rawKey?: string,
  ): Promise<unknown> {
    const productCode = this.product(productCodeInput);
    const key = this.requireKey(rawKey);
    const payloadHash = this.hash({ organizationId, productCode, taxPolicyVersionId, acknowledgement: input.acknowledgement });
    const context = currentEventContext() ?? createRequestContext();
    await this.authorization.requireModuleForProduct(principal, organizationId, productCode, 'CATALOG', 'pricing:tax:manage');

    try {
      return await this.prisma.$transaction(async (tx) => {
        const auth = await this.authorization.requireModuleForProductInTransaction(tx, principal, organizationId, productCode, 'CATALOG', 'pricing:tax:manage');
        await tx.$queryRaw(Prisma.sql`SELECT id FROM tax_policy_versions WHERE id = ${taxPolicyVersionId}::uuid AND organization_id = ${organizationId}::uuid AND product_code = ${productCode} FOR UPDATE`);
        const current = await tx.taxPolicyVersion.findFirst({ where: { id: taxPolicyVersionId, organizationId, productCode } });
        if (!current) throw new NotFoundException('Tax policy version not found');

        const replay = await this.receipt(tx, principal.userId, organizationId, TAX_POLICY_ACTIVATE, key, payloadHash, 'TaxPolicyVersion');
        if (replay) {
          if (replay.resourceId !== taxPolicyVersionId) throw new ConflictException('Idempotency-Key was already used for another tax policy version');
          return this.serializeTaxPolicy(current);
        }
        if (current.status !== 'DRAFT') throw new ConflictException(`Tax policy version cannot be activated from ${current.status}`);

        const active = await tx.taxPolicyVersion.update({ where: { id: taxPolicyVersionId }, data: {
          status: 'ACTIVE', activatedByUserId: principal.userId, activatedAt: new Date(), activationAcknowledgement: input.acknowledgement,
        } });
        await this.writeReceipt(tx, principal.userId, organizationId, TAX_POLICY_ACTIVATE, key, payloadHash, 'TaxPolicyVersion', active.id);
        await this.recordMutation(tx, auth, principal, organizationId, 'PRICING_TAX_POLICY_ACTIVATED', 'pricing.tax_policy_version.activated', 'TaxPolicyVersion', active.id, context, {
          productCode, code: active.code, version: active.version, commandPayloadHash: payloadHash,
          acknowledgement: 'OWNER_REVIEWED_CONFIGURATION',
        });
        return this.serializeTaxPolicy(active);
      }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    } catch (error) {
      if (this.isUniqueViolation(error)) return this.resolveActivationReplay(principal, organizationId, productCode, taxPolicyVersionId, key, payloadHash);
      throw error;
    }
  }

  private async assertConfigurationReferences(
    tx: Prisma.TransactionClient,
    organizationId: string,
    productCode: ProductCode,
    currencies: string[],
    fxSources: string[],
    taxPolicyCodes: string[],
  ): Promise<void> {
    if (currencies.length) {
      const activeCurrencies = await tx.currencyDefinition.findMany({ where: { code: { in: currencies }, active: true }, select: { code: true } });
      if (activeCurrencies.length !== currencies.length) throw new BadRequestException('allowedCurrencies must contain only active registered currencies');
    }
    if (fxSources.length) {
      const approved = new Set(this.config.get<string[]>('PRICING_FX_ALLOWED_SOURCES') ?? []);
      if (fxSources.some((source) => !approved.has(source))) throw new BadRequestException('allowedFxSources must be approved by the platform ingestion configuration');
    }
    if (taxPolicyCodes.length) {
      const activePolicies = await tx.taxPolicyVersion.findMany({
        where: { organizationId, productCode, code: { in: taxPolicyCodes }, status: 'ACTIVE' },
        distinct: ['code'], select: { code: true },
      });
      if (activePolicies.length !== taxPolicyCodes.length) throw new BadRequestException('taxPolicyCodes must refer to active tax policy configurations in the same tenant and product');
    }
  }

  private async lockVersionScope(tx: Prisma.TransactionClient, kind: string, organizationId: string, productCode: ProductCode, code: string): Promise<void> {
    const key = `${kind}:${organizationId}:${productCode}:${code}`;
    await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
  }

  private async receipt(
    tx: Prisma.TransactionClient,
    actorUserId: string,
    organizationId: string,
    operation: string,
    idempotencyKey: string,
    payloadHash: string,
    resourceType: string,
  ): Promise<{ resourceId: string } | null> {
    const receipt = await tx.catalogCommandReceipt.findUnique({
      where: { organizationId_actorUserId_operation_idempotencyKey: { organizationId, actorUserId, operation, idempotencyKey } },
      select: { payloadHash: true, resourceType: true, resourceId: true },
    });
    if (!receipt) return null;
    if (receipt.payloadHash !== payloadHash || receipt.resourceType !== resourceType) throw new ConflictException('Idempotency-Key was already used for a different command');
    return { resourceId: receipt.resourceId };
  }

  private async writeReceipt(tx: Prisma.TransactionClient, actorUserId: string, organizationId: string, operation: string, idempotencyKey: string, payloadHash: string, resourceType: string, resourceId: string): Promise<void> {
    await tx.catalogCommandReceipt.create({ data: { id: randomUUID(), organizationId, actorUserId, operation, idempotencyKey, payloadHash, resourceType, resourceId } });
  }

  private async resolveCreateReplay(principal: AuthPrincipal, organizationId: string, productCode: ProductCode, operation: string, key: string, payloadHash: string, resourceType: 'PricingPolicyVersion' | 'TaxPolicyVersion'): Promise<unknown> {
    const permission = operation === POLICY_CREATE ? 'pricing:policy:manage' : 'pricing:tax:manage';
    await this.authorization.requireModuleForProduct(principal, organizationId, productCode, 'CATALOG', permission);
    const receipt = await this.prisma.catalogCommandReceipt.findUnique({ where: { organizationId_actorUserId_operation_idempotencyKey: { organizationId, actorUserId: principal.userId, operation, idempotencyKey: key } }, select: { payloadHash: true, resourceType: true, resourceId: true } });
    if (!receipt) throw new ConflictException('Concurrent pricing policy command conflicted; retry with the same idempotency key');
    if (receipt.payloadHash !== payloadHash || receipt.resourceType !== resourceType) throw new ConflictException('Idempotency-Key was already used for a different command');
    if (resourceType === 'PricingPolicyVersion') {
      const policy = await this.prisma.pricingPolicyVersion.findFirst({ where: { id: receipt.resourceId, organizationId, productCode } });
      if (!policy) throw new ConflictException('Idempotent pricing policy version is no longer available');
      return this.serializePricingPolicy(policy);
    }
    const policy = await this.prisma.taxPolicyVersion.findFirst({ where: { id: receipt.resourceId, organizationId, productCode } });
    if (!policy) throw new ConflictException('Idempotent tax policy version is no longer available');
    return this.serializeTaxPolicy(policy);
  }

  private async resolveActivationReplay(principal: AuthPrincipal, organizationId: string, productCode: ProductCode, taxPolicyVersionId: string, key: string, payloadHash: string): Promise<unknown> {
    await this.authorization.requireModuleForProduct(principal, organizationId, productCode, 'CATALOG', 'pricing:tax:manage');
    const receipt = await this.prisma.catalogCommandReceipt.findUnique({ where: { organizationId_actorUserId_operation_idempotencyKey: { organizationId, actorUserId: principal.userId, operation: TAX_POLICY_ACTIVATE, idempotencyKey: key } }, select: { payloadHash: true, resourceType: true, resourceId: true } });
    if (!receipt || receipt.payloadHash !== payloadHash || receipt.resourceType !== 'TaxPolicyVersion' || receipt.resourceId !== taxPolicyVersionId) {
      throw new ConflictException('Concurrent tax policy activation conflicted or used a divergent idempotency command');
    }
    const policy = await this.prisma.taxPolicyVersion.findFirst({ where: { id: taxPolicyVersionId, organizationId, productCode } });
    if (!policy) throw new NotFoundException('Tax policy version not found');
    return this.serializeTaxPolicy(policy);
  }

  private async recordMutation(
    tx: Prisma.TransactionClient,
    auth: { productCode: ProductCode },
    principal: AuthPrincipal,
    organizationId: string,
    action: AuditAction,
    eventType: string,
    aggregateType: 'PricingPolicyVersion' | 'TaxPolicyVersion',
    aggregateId: string,
    context: { requestId?: string; correlationId: string },
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await tx.auditEvent.create({ data: {
      id: randomUUID(), action, actorUserId: principal.userId, organizationId, targetType: aggregateType, targetId: aggregateId,
      requestId: context.requestId ?? null, correlationId: context.correlationId,
      metadataJson: metadata as Prisma.InputJsonValue,
    } });
    await this.outbox.enqueue(tx, createDomainEvent({
      eventType, eventVersion: 1, occurredAt: new Date().toISOString(), actor: { type: 'USER', id: principal.userId },
      aggregate: { type: aggregateType, id: aggregateId }, organizationId, correlationId: context.correlationId,
      ...(context.requestId ? { requestId: context.requestId } : {}), dataClassification: 'CONFIDENTIAL', purpose: 'commercial-pricing-policy',
      payload: { productCode: auth.productCode, ...metadata },
    }));
  }

  private serializePricingPolicy(value: {
    id: string; organizationId: string; productCode: string; code: string; version: number; effectiveFrom: Date;
    roundingMode: string; calculationScale: number; maxFxAgeSeconds: number; allowedCurrencies: string[]; allowedFxSources: string[];
    discountRuleCodes: string[]; taxPolicyCodes: string[]; createdAt: Date;
  }): Record<string, unknown> {
    return {
      id: value.id, organizationId: value.organizationId, productCode: value.productCode, code: value.code, version: value.version,
      effectiveFrom: value.effectiveFrom.toISOString(), roundingMode: value.roundingMode, calculationScale: value.calculationScale,
      maxFxAgeSeconds: value.maxFxAgeSeconds, allowedCurrencies: value.allowedCurrencies, allowedFxSources: value.allowedFxSources,
      discountRuleCodes: value.discountRuleCodes, taxPolicyCodes: value.taxPolicyCodes, createdAt: value.createdAt.toISOString(),
    };
  }

  private serializeTaxPolicy(value: {
    id: string; organizationId: string; productCode: string; code: string; version: number; status: TaxPolicyStatus;
    jurisdictionCode: string; taxCategoryCode: string; rate: Prisma.Decimal; calculationCurrency: TaxCalculationCurrency;
    effectiveFrom: Date; configurationReference: string; activatedAt: Date | null; createdAt: Date;
  }): Record<string, unknown> {
    return {
      id: value.id, organizationId: value.organizationId, productCode: value.productCode, code: value.code, version: value.version,
      status: value.status, jurisdictionCode: value.jurisdictionCode, taxCategoryCode: value.taxCategoryCode,
      rate: value.rate.toFixed(18), calculationCurrency: value.calculationCurrency, effectiveFrom: value.effectiveFrom.toISOString(),
      configurationReference: value.configurationReference, activatedAt: value.activatedAt?.toISOString() ?? null,
      tenantReviewAcknowledgement: value.activatedAt ? 'OWNER_REVIEWED_CONFIGURATION' : null, createdAt: value.createdAt.toISOString(),
    };
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

  private effectiveFrom(value: string | undefined, fallback: Date): Date {
    const date = value === undefined ? fallback : new Date(value);
    if (Number.isNaN(date.getTime())) throw new BadRequestException('effectiveFrom must be a valid RFC3339 timestamp');
    return date;
  }

  private canonicalList(values: string[], pattern: RegExp): string[] {
    const normalized = values.map((value) => value.trim());
    if (normalized.some((value) => !pattern.test(value))) throw new BadRequestException('Policy codes contain an invalid value');
    const canonical = [...new Set(normalized)].sort();
    if (canonical.length !== values.length) throw new BadRequestException('Policy arrays must contain unique canonical values');
    return canonical;
  }

  private nonNegativeRate(value: string): string {
    if (!/^(?:0|[1-9]\d{0,5})(?:\.\d{1,18})?$/.test(value)) throw new BadRequestException('Tax rate must be non-negative with at most 6 integer and 18 fractional digits');
    const rate = new Prisma.Decimal(value);
    if (!rate.isFinite() || rate.isNegative()) throw new BadRequestException('Tax rate must be a finite non-negative decimal');
    return rate.toFixed(18);
  }

  private hash(payload: unknown): string {
    return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  }

  private isUniqueViolation(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
  }
}
