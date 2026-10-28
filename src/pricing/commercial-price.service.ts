import { createHash, randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service.js';
import type { AuthPrincipal, ProductAuthorizationContext } from '../auth/auth.types.js';
import { AuthorizationService } from '../tenancy/authorization.service.js';
import { createDomainEvent } from '../events/domain-event.factory.js';
import { createRequestContext, currentEventContext } from '../events/event-context.js';
import { PrismaOutboxWriter } from '../events/prisma-outbox.writer.js';
import type { CreateCommercialPriceVersionDto } from '../referentials/commercial-catalog.dto.js';
import { isProductCode } from '../products/product-code.js';

const OPERATION = 'COMMERCIAL_PRICE_VERSION_PUBLISH';

@Injectable()
export class CommercialPriceService {
  constructor(private readonly prisma: PrismaService, private readonly authorization: AuthorizationService, private readonly outbox: PrismaOutboxWriter) {}

  async publish(principal: AuthPrincipal, organizationId: string, offerId: string, input: CreateCommercialPriceVersionDto, rawKey?: string): Promise<unknown> {
    const key = this.requireKey(rawKey);
    const offer = await this.prisma.commercialOffer.findFirst({
      where: { id: offerId, organizationId },
      select: { id: true, organizationId: true, productCode: true, establishmentId: true, sellUnitCode: true },
    });
    if (!offer) throw new NotFoundException('Commercial offer not found');
    if (!isProductCode(offer.productCode)) throw new ConflictException('Commercial offer uses an unsupported product code');
    if (typeof input.amount !== 'string' || !/^(?=.*[1-9])(?:0|[1-9]\d{0,15})(?:\.\d{1,8})?$/.test(input.amount)) {
      throw new BadRequestException('Price amount must be positive with at most 16 integer and 8 fractional digits');
    }
    if (!/^[A-Z]{3}$/.test(input.currencyCode) || !/^[A-Za-z][A-Za-z0-9_]{0,31}$/.test(input.priceUnitCode)) {
      throw new BadRequestException('Price currency or unit code is invalid');
    }

    const context = await this.authorization.requireModuleForProduct(principal, organizationId, offer.productCode, 'CATALOG', 'pricing:price:publish');
    if (offer.establishmentId) await this.authorization.assertEstablishment(context, offer.establishmentId);

    const amount = new Prisma.Decimal(input.amount).toFixed(8);
    const requestedEffectiveFrom = input.effectiveFrom ? new Date(input.effectiveFrom) : null;
    if (requestedEffectiveFrom && Number.isNaN(requestedEffectiveFrom.getTime())) throw new BadRequestException('effectiveFrom must be a valid timestamp');
    const payload = {
      offerId,
      productCode: offer.productCode,
      amount,
      currencyCode: input.currencyCode,
      priceUnitCode: input.priceUnitCode.trim().toUpperCase(),
      effectiveFrom: requestedEffectiveFrom?.toISOString() ?? null,
      expectedLatestVersionId: input.expectedLatestVersionId ?? null,
    };
    const payloadHash = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
    const commandTime = new Date();

    try {
      return await this.prisma.$transaction(async (tx) => {
        const txContext = await this.authorization.requireModuleForProductInTransaction(
          tx, principal, organizationId, offer.productCode, 'CATALOG', 'pricing:price:publish',
        );
        const lockedOffer = await tx.$queryRaw<Array<{ id: string; establishment_id: string | null }>>`
          SELECT id, establishment_id FROM commercial_offers WHERE id = ${offerId}::uuid AND organization_id = ${organizationId}::uuid FOR UPDATE
        `;
        if (lockedOffer.length !== 1) throw new NotFoundException('Commercial offer not found');
        if (lockedOffer[0]!.establishment_id) await this.assertEstablishmentInTransaction(tx, txContext, lockedOffer[0]!.establishment_id);

        const receipt = await tx.catalogCommandReceipt.findUnique({
          where: { organizationId_actorUserId_operation_idempotencyKey: { organizationId, actorUserId: principal.userId, operation: OPERATION, idempotencyKey: key } },
          select: { payloadHash: true, resourceType: true, resourceId: true },
        });
        if (receipt) {
          if (receipt.payloadHash !== payloadHash || receipt.resourceType !== 'CommercialPriceVersion') {
            throw new ConflictException('Idempotency-Key was already used for a different command');
          }
          const prior = await tx.commercialPriceVersion.findFirst({ where: { id: receipt.resourceId, organizationId, offerId } });
          if (!prior) throw new ConflictException('Idempotent price version is no longer available');
          return this.serialize(prior);
        }

        if (requestedEffectiveFrom && requestedEffectiveFrom <= commandTime) {
          throw new BadRequestException('A published price cannot be backdated or effective at a past instant');
        }

        const currentOffer = await tx.commercialOffer.findFirst({
          where: { id: offerId, organizationId },
          select: { id: true, productCode: true, establishmentId: true, sellUnitCode: true, status: true, item: { select: { active: true } }, variant: { select: { active: true } } },
        });
        if (!currentOffer || currentOffer.status !== 'ACTIVE' || !currentOffer.item.active || currentOffer.variant?.active === false) {
          throw new ConflictException('A price can only be published for an active offer and active catalog resource');
        }
        const [currency, priceUnit, sellUnit] = await Promise.all([
          tx.currencyDefinition.findFirst({ where: { code: input.currencyCode, active: true }, select: { code: true } }),
          tx.measureUnit.findFirst({ where: { code: payload.priceUnitCode, active: true }, select: { code: true, dimension: true, baseUnitCode: true } }),
          tx.measureUnit.findFirst({ where: { code: currentOffer.sellUnitCode, active: true }, select: { code: true, dimension: true, baseUnitCode: true } }),
        ]);
        if (!currency) throw new BadRequestException('currencyCode is not in the active currency registry');
        if (!priceUnit || !sellUnit || priceUnit.dimension !== sellUnit.dimension || priceUnit.baseUnitCode !== sellUnit.baseUnitCode) {
          throw new BadRequestException('priceUnitCode must be an active unit compatible with the offer sell unit');
        }

        const latest = await tx.commercialPriceVersion.findFirst({
          where: { organizationId, offerId, currencyCode: input.currencyCode },
          orderBy: [{ effectiveFrom: 'desc' }, { version: 'desc' }],
          select: { id: true, version: true, effectiveFrom: true },
        });
        if (input.expectedLatestVersionId !== undefined && input.expectedLatestVersionId !== (latest?.id ?? null)) {
          throw new ConflictException('The latest price version changed');
        }
        const effectiveFrom = requestedEffectiveFrom ?? commandTime;
        if (latest && effectiveFrom <= latest.effectiveFrom) throw new ConflictException('Price versions must be appended in strictly increasing effective order');

        const id = randomUUID();
        const version = await tx.commercialPriceVersion.create({
          data: {
            id, organizationId, productCode: currentOffer.productCode, offerId, version: (latest?.version ?? 0) + 1,
            currencyCode: input.currencyCode, amount: new Prisma.Decimal(amount), priceUnitCode: payload.priceUnitCode,
            effectiveFrom, publishedByUserId: principal.userId, commandPayloadHash: payloadHash,
          },
        });
        await tx.catalogCommandReceipt.create({ data: {
          id: randomUUID(), organizationId, actorUserId: principal.userId, operation: OPERATION,
          idempotencyKey: key, payloadHash, resourceType: 'CommercialPriceVersion', resourceId: id,
        } });
        await this.recordPublication(tx, txContext, principal, organizationId, version.id, version.version, payloadHash);
        return this.serialize(version);
      }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('A competing price-version command changed the offer; reload its latest version and retry with a new key');
      }
      throw error;
    }
  }

  private async assertEstablishmentInTransaction(tx: Prisma.TransactionClient, context: ProductAuthorizationContext, establishmentId: string): Promise<void> {
    const active = await tx.establishment.findFirst({ where: { id: establishmentId, organizationId: context.organizationId, status: 'ACTIVE' }, select: { id: true } });
    if (!active || (context.scopeMode === 'SELECTED_ESTABLISHMENTS' && !context.establishmentIds.includes(establishmentId))) {
      throw new NotFoundException('Commercial offer not found');
    }
  }

  private async recordPublication(tx: Prisma.TransactionClient, context: ProductAuthorizationContext, principal: AuthPrincipal, organizationId: string, id: string, version: number, payloadHash: string): Promise<void> {
    const current = currentEventContext();
    const request = current?.requestId ? { requestId: current.requestId, correlationId: current.correlationId } : createRequestContext();
    await tx.auditEvent.create({ data: {
      id: randomUUID(), action: 'COMMERCIAL_PRICE_VERSION_PUBLISHED', actorUserId: principal.userId, organizationId,
      targetType: 'CommercialPriceVersion', targetId: id, requestId: request.requestId, correlationId: request.correlationId,
      metadataJson: { productCode: context.productCode, offerVersion: version, commandPayloadHash: payloadHash },
    } });
    await this.outbox.enqueue(tx, createDomainEvent({
      eventType: 'catalog.price_version.published', eventVersion: 1, occurredAt: new Date().toISOString(),
      actor: { type: 'USER', id: principal.userId }, aggregate: { type: 'CommercialPriceVersion', id }, organizationId,
      correlationId: request.correlationId, ...(request.requestId ? { requestId: request.requestId } : {}),
      dataClassification: 'CONFIDENTIAL', purpose: 'commercial-pricing',
      payload: { productCode: context.productCode, priceVersionId: id, version, commandPayloadHash: payloadHash },
    }));
  }

  private serialize(value: { id: string; offerId: string; amount: Prisma.Decimal; currencyCode: string; priceUnitCode: string; effectiveFrom: Date; version: number }): unknown {
    return { id: value.id, offerId: value.offerId, amount: value.amount.toFixed(8), currencyCode: value.currencyCode, priceUnitCode: value.priceUnitCode, effectiveFrom: value.effectiveFrom.toISOString(), version: value.version };
  }

  private requireKey(value?: string): string {
    if (!value?.trim() || value.length > 200 || /[\r\n]/.test(value)) throw new BadRequestException('Idempotency-Key is required and invalid');
    return value.trim();
  }
}
