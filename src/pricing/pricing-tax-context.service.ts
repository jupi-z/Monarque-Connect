import { createHash, randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type AuditAction, type TaxPolicyStatus } from '@prisma/client';
import type { AuthPrincipal, ProductAuthorizationContext } from '../auth/auth.types.js';
import { PrismaService } from '../database/prisma.service.js';
import { createDomainEvent } from '../events/domain-event.factory.js';
import { createRequestContext, currentEventContext } from '../events/event-context.js';
import { PrismaOutboxWriter } from '../events/prisma-outbox.writer.js';
import { AuthorizationService } from '../tenancy/authorization.service.js';
import { isProductCode, type ProductCode } from '../products/product-code.js';
import type { ActivatePricingTaxContextVersionDto, ClassifyCommercialOfferTaxDto, CreatePricingTaxContextVersionDto } from './pricing-tax-context.dto.js';

const CONTEXT_CREATE = 'PRICING_TAX_CONTEXT_CREATE';
const CONTEXT_ACTIVATE = 'PRICING_TAX_CONTEXT_ACTIVATE';
const OFFER_CLASSIFY = 'COMMERCIAL_OFFER_TAX_CLASSIFY';
const ACKNOWLEDGEMENT = 'OWNER_REVIEWED_CONFIGURATION';
const JURISDICTION_PATTERN = /^[A-Z0-9][A-Z0-9._:-]{1,63}$/;
const CATEGORY_PATTERN = /^[A-Z][A-Z0-9._-]{0,63}$/;

type Receipt = { payloadHash: string; resourceType: string; resourceId: string };

@Injectable()
export class PricingTaxContextService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorization: AuthorizationService,
    private readonly outbox: PrismaOutboxWriter,
  ) {}

  async create(
    principal: AuthPrincipal,
    organizationId: string,
    input: CreatePricingTaxContextVersionDto,
    rawKey?: string,
  ): Promise<Record<string, unknown>> {
    const productCode = this.product(input.productCode);
    const establishmentId = input.establishmentId ?? null;
    const key = this.requireKey(rawKey);
    const commandTime = new Date();
    const effectiveFrom = this.effectiveFrom(input.effectiveFrom, commandTime);
    if (input.effectiveFrom !== undefined && effectiveFrom <= commandTime) throw new BadRequestException('effectiveFrom must be in the future');
    const jurisdictionCode = input.jurisdictionCode.trim().toUpperCase();
    if (!JURISDICTION_PATTERN.test(jurisdictionCode)) throw new BadRequestException('jurisdictionCode is invalid');
    const payloadHash = this.hash({ productCode, establishmentId, jurisdictionCode, effectiveFrom: input.effectiveFrom === undefined ? null : effectiveFrom.toISOString() });

    const initial = await this.authorization.requireModuleForProduct(principal, organizationId, productCode, 'CATALOG', 'pricing:tax:manage');
    if (establishmentId) await this.authorization.assertEstablishment(initial, establishmentId);

    try {
      return await this.prisma.$transaction(async (tx) => {
        const auth = await this.authorization.requireModuleForProductInTransaction(tx, principal, organizationId, productCode, 'CATALOG', 'pricing:tax:manage');
        if (establishmentId) await this.assertEstablishmentInTransaction(tx, auth, establishmentId);
        await this.lockScope(tx, organizationId, productCode, establishmentId);
        const replay = await this.receipt(tx, principal.userId, organizationId, CONTEXT_CREATE, key, payloadHash, 'PricingTaxContextVersion');
        if (replay) {
          const prior = await tx.pricingTaxContextVersion.findFirst({ where: { id: replay.resourceId, organizationId, productCode } });
          if (!prior) throw new ConflictException('Idempotent pricing tax context is no longer available');
          return this.serializeContext(prior);
        }

        const scope = { organizationId, productCode, establishmentId };
        const latest = await tx.pricingTaxContextVersion.findFirst({ where: scope, orderBy: { version: 'desc' }, select: { version: true, effectiveFrom: true } });
        if (latest && effectiveFrom <= latest.effectiveFrom) throw new ConflictException('Tax context versions in the same scope require strictly increasing effective times');

        const context = await tx.pricingTaxContextVersion.create({ data: {
          id: randomUUID(), ...scope, version: (latest?.version ?? 0) + 1, status: 'DRAFT', jurisdictionCode, effectiveFrom,
          createdByUserId: principal.userId, commandPayloadHash: payloadHash,
        } });
        await this.writeReceipt(tx, organizationId, principal.userId, CONTEXT_CREATE, key, payloadHash, 'PricingTaxContextVersion', context.id);
        await this.recordMutation(tx, auth, principal, organizationId, context.id, context.establishmentId, 'PRICING_TAX_CONTEXT_DRAFT_CREATED', 'pricing.tax_context_version.draft_created', context.version, payloadHash);
        return this.serializeContext(context);
      }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    } catch (error) {
      if (this.isUniqueViolation(error)) return this.resolveCreateReplay(principal, organizationId, productCode, key, payloadHash);
      throw error;
    }
  }

  async activate(
    principal: AuthPrincipal,
    organizationId: string,
    versionId: string,
    productCodeInput: string,
    input: ActivatePricingTaxContextVersionDto,
    rawKey?: string,
  ): Promise<Record<string, unknown>> {
    const productCode = this.product(productCodeInput);
    const key = this.requireKey(rawKey);
    const payloadHash = this.hash({ organizationId, productCode, versionId, acknowledgement: input.acknowledgement });
    await this.authorization.requireModuleForProduct(principal, organizationId, productCode, 'CATALOG', 'pricing:tax:manage');

    try {
      return await this.prisma.$transaction(async (tx) => {
        const auth = await this.authorization.requireModuleForProductInTransaction(tx, principal, organizationId, productCode, 'CATALOG', 'pricing:tax:manage');
        const located = await tx.pricingTaxContextVersion.findFirst({ where: { id: versionId, organizationId, productCode } });
        if (!located) throw new NotFoundException('Pricing tax context version not found');
        if (located.establishmentId) await this.assertEstablishmentInTransaction(tx, auth, located.establishmentId);
        await this.lockScope(tx, organizationId, productCode, located.establishmentId);
        const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT id FROM pricing_tax_context_versions WHERE id = ${versionId}::uuid AND organization_id = ${organizationId}::uuid AND product_code = ${productCode} FOR UPDATE`);
        if (locked.length !== 1) throw new NotFoundException('Pricing tax context version not found');
        const current = await tx.pricingTaxContextVersion.findFirst({ where: { id: versionId, organizationId, productCode } });
        if (!current) throw new NotFoundException('Pricing tax context version not found');
        if (current.establishmentId) await this.assertEstablishmentInTransaction(tx, auth, current.establishmentId);

        const replay = await this.receipt(tx, principal.userId, organizationId, CONTEXT_ACTIVATE, key, payloadHash, 'PricingTaxContextVersion');
        if (replay) {
          if (replay.resourceId !== versionId) throw new ConflictException('Idempotency-Key was already used for another tax context version');
          return this.serializeContext(current);
        }
        if (current.status !== 'DRAFT') throw new ConflictException(`Tax context version cannot be activated from ${current.status}`);

        const active = await tx.pricingTaxContextVersion.update({ where: { id: versionId }, data: {
          status: 'ACTIVE', activatedByUserId: principal.userId, activatedAt: new Date(), activationAcknowledgement: input.acknowledgement,
        } });
        await this.writeReceipt(tx, organizationId, principal.userId, CONTEXT_ACTIVATE, key, payloadHash, 'PricingTaxContextVersion', active.id);
        await this.recordMutation(tx, auth, principal, organizationId, active.id, active.establishmentId, 'PRICING_TAX_CONTEXT_ACTIVATED', 'pricing.tax_context_version.activated', active.version, payloadHash);
        return this.serializeContext(active);
      }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    } catch (error) {
      if (this.isUniqueViolation(error)) return this.resolveActivationReplay(principal, organizationId, productCode, versionId, key, payloadHash);
      throw error;
    }
  }

  async classifyOffer(
    principal: AuthPrincipal,
    organizationId: string,
    offerId: string,
    input: ClassifyCommercialOfferTaxDto,
    rawKey?: string,
  ): Promise<Record<string, unknown>> {
    const key = this.requireKey(rawKey);
    const taxCategoryCode = input.taxCategoryCode === null ? null : input.taxCategoryCode.trim().toUpperCase();
    if (taxCategoryCode !== null && !CATEGORY_PATTERN.test(taxCategoryCode)) throw new BadRequestException('taxCategoryCode is invalid');
    const membership = await this.authorization.requireMembership(principal, organizationId);
    this.authorization.assertPermission(membership, 'pricing:tax:manage');
    const current = await this.prisma.commercialOffer.findFirst({ where: { id: offerId, organizationId } });
    if (!current) throw new NotFoundException('Commercial offer not found');
    const productCode = this.product(current.productCode);
    const initial = await this.authorization.requireModuleForProduct(principal, organizationId, productCode, 'CATALOG', 'pricing:tax:manage');
    if (current.establishmentId) await this.authorization.assertEstablishment(initial, current.establishmentId);
    const payloadHash = this.hash({ operation: OFFER_CLASSIFY, offerId, expectedVersion: input.expectedVersion, taxCategoryCode });

    try {
      return await this.prisma.$transaction(async (tx) => {
        const auth = await this.authorization.requireModuleForProductInTransaction(tx, principal, organizationId, productCode, 'CATALOG', 'pricing:tax:manage');
        const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT id FROM commercial_offers WHERE id = ${offerId}::uuid AND organization_id = ${organizationId}::uuid AND product_code = ${productCode} FOR UPDATE`);
        if (locked.length !== 1) throw new NotFoundException('Commercial offer not found');
        const offer = await tx.commercialOffer.findFirst({ where: { id: offerId, organizationId, productCode } });
        if (!offer) throw new NotFoundException('Commercial offer not found');
        if (offer.establishmentId) await this.assertEstablishmentInTransaction(tx, auth, offer.establishmentId);

        const replay = await this.receipt(tx, principal.userId, organizationId, OFFER_CLASSIFY, key, payloadHash, 'CommercialOffer');
        if (replay) {
          if (replay.resourceId !== offerId) throw new ConflictException('Idempotency-Key was already used for another offer');
          return this.serializeOffer(offer);
        }
        const updated = await tx.commercialOffer.updateMany({
          where: { id: offerId, organizationId, productCode, version: input.expectedVersion },
          data: { taxCategoryCode, version: { increment: 1 } },
        });
        if (updated.count !== 1) throw new ConflictException('Commercial offer version changed');
        const changed = await tx.commercialOffer.findFirstOrThrow({ where: { id: offerId, organizationId, productCode } });
        await this.writeReceipt(tx, organizationId, principal.userId, OFFER_CLASSIFY, key, payloadHash, 'CommercialOffer', offerId);
        const context = currentEventContext() ?? createRequestContext();
        await tx.auditEvent.create({ data: {
          id: randomUUID(), action: 'CATALOG_OFFER_TAX_CLASSIFICATION_CHANGED', actorUserId: principal.userId, organizationId,
          ...(offer.establishmentId ? { establishmentId: offer.establishmentId } : {}), targetType: 'CommercialOffer', targetId: offerId,
          requestId: context.requestId ?? null, correlationId: context.correlationId,
          metadataJson: { productCode, version: changed.version, classificationSet: taxCategoryCode !== null, commandPayloadHash: payloadHash },
        } });
        await this.outbox.enqueue(tx, createDomainEvent({
          eventType: 'catalog.offer.tax_classification_changed', eventVersion: 1, occurredAt: new Date().toISOString(),
          actor: { type: 'USER', id: principal.userId }, aggregate: { type: 'CommercialOffer', id: offerId }, organizationId,
          ...(offer.establishmentId ? { establishmentId: offer.establishmentId } : {}), correlationId: context.correlationId,
          ...(context.requestId ? { requestId: context.requestId } : {}), dataClassification: 'CONFIDENTIAL', purpose: 'commercial-catalog-tax-configuration',
          payload: { productCode, offerId, version: changed.version, commandPayloadHash: payloadHash },
        }));
        return this.serializeOffer(changed);
      }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    } catch (error) {
      if (this.isUniqueViolation(error)) return this.resolveOfferReplay(principal, organizationId, productCode, offerId, key, payloadHash);
      throw error;
    }
  }

  private async lockScope(tx: Prisma.TransactionClient, organizationId: string, productCode: ProductCode, establishmentId: string | null): Promise<void> {
    const key = `pricing-tax-context:${organizationId}:${productCode}:${establishmentId ?? 'ORGANIZATION_DEFAULT'}`;
    await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
  }

  private async assertEstablishmentInTransaction(tx: Prisma.TransactionClient, context: ProductAuthorizationContext, establishmentId: string): Promise<void> {
    const establishment = await tx.establishment.findFirst({ where: { id: establishmentId, organizationId: context.organizationId, status: 'ACTIVE' }, select: { id: true } });
    if (!establishment || (context.scopeMode === 'SELECTED_ESTABLISHMENTS' && !context.establishmentIds.includes(establishmentId))) {
      throw new ForbiddenException('Establishment access denied');
    }
  }

  private async receipt(tx: Prisma.TransactionClient, actorUserId: string, organizationId: string, operation: string, key: string, payloadHash: string, resourceType: string): Promise<Receipt | null> {
    const receipt = await tx.catalogCommandReceipt.findUnique({
      where: { organizationId_actorUserId_operation_idempotencyKey: { organizationId, actorUserId, operation, idempotencyKey: key } },
      select: { payloadHash: true, resourceType: true, resourceId: true },
    });
    if (!receipt) return null;
    if (receipt.payloadHash !== payloadHash || receipt.resourceType !== resourceType) throw new ConflictException('Idempotency-Key was already used for a different command');
    return receipt;
  }

  private async writeReceipt(tx: Prisma.TransactionClient, organizationId: string, actorUserId: string, operation: string, key: string, payloadHash: string, resourceType: string, resourceId: string): Promise<void> {
    await tx.catalogCommandReceipt.create({ data: { id: randomUUID(), organizationId, actorUserId, operation, idempotencyKey: key, payloadHash, resourceType, resourceId } });
  }

  private async recordMutation(tx: Prisma.TransactionClient, auth: ProductAuthorizationContext, principal: AuthPrincipal, organizationId: string, id: string, establishmentId: string | null, action: AuditAction, eventType: string, version: number, payloadHash: string): Promise<void> {
    const context = currentEventContext() ?? createRequestContext();
    await tx.auditEvent.create({ data: {
      id: randomUUID(), action, actorUserId: principal.userId, organizationId, ...(establishmentId ? { establishmentId } : {}),
      targetType: 'PricingTaxContextVersion', targetId: id, requestId: context.requestId ?? null, correlationId: context.correlationId,
      metadataJson: { productCode: auth.productCode, version, commandPayloadHash: payloadHash },
    } });
    await this.outbox.enqueue(tx, createDomainEvent({
      eventType, eventVersion: 1, occurredAt: new Date().toISOString(), actor: { type: 'USER', id: principal.userId },
      aggregate: { type: 'PricingTaxContextVersion', id }, organizationId, ...(establishmentId ? { establishmentId } : {}),
      correlationId: context.correlationId, ...(context.requestId ? { requestId: context.requestId } : {}),
      dataClassification: 'CONFIDENTIAL', purpose: 'commercial-pricing-tax-context',
      payload: { productCode: auth.productCode, version, commandPayloadHash: payloadHash },
    }));
  }

  private async resolveCreateReplay(principal: AuthPrincipal, organizationId: string, productCode: ProductCode, key: string, payloadHash: string): Promise<Record<string, unknown>> {
    await this.authorization.requireModuleForProduct(principal, organizationId, productCode, 'CATALOG', 'pricing:tax:manage');
    const receipt = await this.prisma.catalogCommandReceipt.findUnique({ where: { organizationId_actorUserId_operation_idempotencyKey: { organizationId, actorUserId: principal.userId, operation: CONTEXT_CREATE, idempotencyKey: key } } });
    if (!receipt || receipt.resourceType !== 'PricingTaxContextVersion' || receipt.payloadHash !== payloadHash) throw new ConflictException('Concurrent tax context command conflicted or used a divergent idempotency command');
    const context = await this.prisma.pricingTaxContextVersion.findFirst({ where: { id: receipt.resourceId, organizationId, productCode } });
    if (!context) throw new ConflictException('Idempotent pricing tax context is no longer available');
    if (context.establishmentId) await this.authorization.assertEstablishment(await this.authorization.requireModuleForProduct(principal, organizationId, productCode, 'CATALOG', 'pricing:tax:manage'), context.establishmentId);
    return this.serializeContext(context);
  }

  private async resolveActivationReplay(principal: AuthPrincipal, organizationId: string, productCode: ProductCode, versionId: string, key: string, payloadHash: string): Promise<Record<string, unknown>> {
    const auth = await this.authorization.requireModuleForProduct(principal, organizationId, productCode, 'CATALOG', 'pricing:tax:manage');
    const receipt = await this.prisma.catalogCommandReceipt.findUnique({ where: { organizationId_actorUserId_operation_idempotencyKey: { organizationId, actorUserId: principal.userId, operation: CONTEXT_ACTIVATE, idempotencyKey: key } } });
    if (!receipt || receipt.resourceType !== 'PricingTaxContextVersion' || receipt.resourceId !== versionId || receipt.payloadHash !== payloadHash) {
      throw new ConflictException('Concurrent tax context activation conflicted or used a divergent idempotency command');
    }
    const context = await this.prisma.pricingTaxContextVersion.findFirst({ where: { id: versionId, organizationId, productCode } });
    if (!context) throw new ConflictException('Idempotent pricing tax context is no longer available');
    if (context.establishmentId) await this.authorization.assertEstablishment(auth, context.establishmentId);
    return this.serializeContext(context);
  }

  private async resolveOfferReplay(principal: AuthPrincipal, organizationId: string, productCode: ProductCode, offerId: string, key: string, payloadHash: string): Promise<Record<string, unknown>> {
    await this.authorization.requireModuleForProduct(principal, organizationId, productCode, 'CATALOG', 'pricing:tax:manage');
    const receipt = await this.prisma.catalogCommandReceipt.findUnique({ where: { organizationId_actorUserId_operation_idempotencyKey: { organizationId, actorUserId: principal.userId, operation: OFFER_CLASSIFY, idempotencyKey: key } } });
    if (!receipt || receipt.resourceType !== 'CommercialOffer' || receipt.resourceId !== offerId || receipt.payloadHash !== payloadHash) throw new ConflictException('Concurrent offer classification conflicted or used a divergent idempotency command');
    const offer = await this.prisma.commercialOffer.findFirst({ where: { id: offerId, organizationId, productCode } });
    if (!offer) throw new NotFoundException('Commercial offer not found');
    const context = await this.authorization.requireModuleForProduct(principal, organizationId, productCode, 'CATALOG', 'pricing:tax:manage');
    if (offer.establishmentId) await this.authorization.assertEstablishment(context, offer.establishmentId);
    return this.serializeOffer(offer);
  }

  private serializeContext(value: {
    id: string; organizationId: string; productCode: string; establishmentId: string | null; version: number; status: TaxPolicyStatus;
    jurisdictionCode: string; effectiveFrom: Date; activatedAt: Date | null; createdAt: Date;
  }): Record<string, unknown> {
    return {
      id: value.id, organizationId: value.organizationId, productCode: value.productCode, establishmentId: value.establishmentId,
      version: value.version, status: value.status, jurisdictionCode: value.jurisdictionCode, effectiveFrom: value.effectiveFrom.toISOString(),
      activatedAt: value.activatedAt?.toISOString() ?? null,
      tenantReviewAcknowledgement: value.activatedAt ? ACKNOWLEDGEMENT : null, createdAt: value.createdAt.toISOString(),
    };
  }

  private serializeOffer(value: {
    id: string; organizationId: string; productCode: string; itemId: string; variantId: string | null; establishmentId: string | null;
    channelCode: string | null; sellUnitCode: string; displayName: string | null; taxCategoryCode: string | null;
    status: string; version: number; createdAt: Date; updatedAt: Date;
  }): Record<string, unknown> {
    return {
      id: value.id, organizationId: value.organizationId, productCode: value.productCode, itemId: value.itemId,
      variantId: value.variantId, establishmentId: value.establishmentId, channelCode: value.channelCode,
      sellUnitCode: value.sellUnitCode, displayName: value.displayName, taxCategoryCode: value.taxCategoryCode,
      status: value.status, version: value.version, createdAt: value.createdAt.toISOString(), updatedAt: value.updatedAt.toISOString(),
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

  private hash(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
  private isUniqueViolation(error: unknown): boolean { return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'; }
}
