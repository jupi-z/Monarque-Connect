import { createHash, randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type AuditAction, type CommercialOfferStatus } from '@prisma/client';
import { PrismaService } from '../database/prisma.service.js';
import { AuthorizationService } from '../tenancy/authorization.service.js';
import type { AuthPrincipal, ProductAuthorizationContext } from '../auth/auth.types.js';
import { createDomainEvent } from '../events/domain-event.factory.js';
import { createRequestContext, currentEventContext } from '../events/event-context.js';
import { PrismaOutboxWriter } from '../events/prisma-outbox.writer.js';
import { isProductCode } from '../products/product-code.js';
import type { CatalogIdempotencyKey, CommercialOfferListQuery, CreateCommercialOfferDto, CreateItemVariantDto, UpdateCommercialOfferDto } from './commercial-catalog.dto.js';

type Cursor = { createdAt: string; id: string };
type CommandReceipt = { resourceType: string; resourceId: string; payloadHash: string };

@Injectable()
export class CommercialCatalogService {
  constructor(private readonly prisma: PrismaService, private readonly authorization: AuthorizationService, private readonly outbox: PrismaOutboxWriter) {}

  async listOffers(principal: AuthPrincipal, organizationId: string, query: CommercialOfferListQuery): Promise<unknown> {
    const context = await this.authorization.requireModuleForProduct(principal, organizationId, query.productCode, 'CATALOG', 'catalog:read');
    if (query.establishmentId) await this.authorization.assertEstablishment(context, query.establishmentId);
    const cursor = query.cursor ? this.decodeCursor(query.cursor) : undefined;
    const channelCode = query.channelCode ? this.optionalCode(query.channelCode) : null;
    const establishmentFilter = query.establishmentId
      ? [{ establishmentId: null }, { establishmentId: query.establishmentId }]
      : context.scopeMode === 'SELECTED_ESTABLISHMENTS'
        ? [{ establishmentId: null }, { establishmentId: { in: [...context.establishmentIds] } }]
        : undefined;
    const cursorFilter = cursor ? { OR: [{ createdAt: { gt: new Date(cursor.createdAt) } }, { createdAt: new Date(cursor.createdAt), id: { gt: cursor.id } }] } : undefined;
    const rows = await this.prisma.commercialOffer.findMany({
      where: {
        organizationId,
        productCode: query.productCode,
        status: 'ACTIVE',
        item: { is: { active: true } },
        sellUnit: { is: { active: true } },
        AND: [
          { OR: [{ variantId: null }, { variant: { is: { active: true } } }] },
          ...(establishmentFilter ? [{ OR: establishmentFilter }] : []),
          { OR: channelCode ? [{ channelCode: null }, { channelCode }] : [{ channelCode: null }] },
          ...(cursorFilter ? [cursorFilter] : []),
        ],
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: query.limit + 1,
      select: this.offerSelect,
    });
    const page = rows.slice(0, query.limit);
    const last = rows.length > query.limit ? page.at(-1) : undefined;
    return { items: page.map((row) => this.serializeOffer(row)), nextCursor: last ? this.encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id }) : null };
  }

  async createOffer(principal: AuthPrincipal, organizationId: string, input: CreateCommercialOfferDto, rawKey: CatalogIdempotencyKey): Promise<unknown> {
    await this.authorize(principal, organizationId, input.productCode, 'catalog:write', input.establishmentId);
    const key = this.requireKey(rawKey);
    const data = {
      productCode: input.productCode,
      itemId: input.itemId,
      variantId: input.variantId ?? null,
      establishmentId: input.establishmentId ?? null,
      channelCode: this.optionalCode(input.channelCode),
      sellUnitCode: this.code(input.sellUnitCode, 32, 'sellUnitCode'),
      displayName: input.displayName?.trim() || null,
    };
    const hash = this.hash({ operation: 'COMMERCIAL_OFFER_CREATE', ...data });
    try {
      return await this.prisma.$transaction(async (tx) => {
        const txContext = await this.authorization.requireModuleForProductInTransaction(tx, principal, organizationId, input.productCode, 'CATALOG', 'catalog:write');
        if (input.establishmentId) await this.assertEstablishmentInTransaction(tx, txContext, input.establishmentId);
        const replay = await this.findReceipt(tx, organizationId, principal.userId, 'COMMERCIAL_OFFER_CREATE', key, hash);
        if (replay) return this.loadOffer(tx, organizationId, replay.resourceId);
        const item = await tx.item.findFirst({ where: { id: data.itemId, organizationId, active: true }, select: { id: true } });
        if (!item) throw new NotFoundException('Catalog item not found');
        const unit = await tx.measureUnit.findFirst({ where: { code: data.sellUnitCode, active: true }, select: { code: true } });
        if (!unit) throw new BadRequestException('sellUnitCode is not an active registered unit');
        if (data.variantId) {
          const variant = await tx.itemVariant.findFirst({ where: { id: data.variantId, itemId: data.itemId, organizationId, active: true }, select: { id: true } });
          if (!variant) throw new NotFoundException('Item variant not found');
        }
        const id = randomUUID();
        const offer = await tx.commercialOffer.create({ data: { id, organizationId, ...data }, select: this.offerSelect });
        await this.createReceipt(tx, organizationId, principal.userId, 'COMMERCIAL_OFFER_CREATE', key, hash, 'CommercialOffer', id);
        await this.recordMutation(tx, txContext, principal, organizationId, id, 'CATALOG_OFFER_CREATED', 'catalog.offer.created', { productCode: data.productCode, itemId: data.itemId, variantId: data.variantId, establishmentId: data.establishmentId });
        return this.serializeOffer(offer);
      });
    } catch (error) {
      if (this.isUniqueViolation(error)) return this.replayOffer(principal, organizationId, 'COMMERCIAL_OFFER_CREATE', key, hash);
      throw error;
    }
  }

  async createVariant(principal: AuthPrincipal, organizationId: string, itemId: string, input: CreateItemVariantDto, rawKey: CatalogIdempotencyKey): Promise<unknown> {
    await this.authorize(principal, organizationId, input.productCode, 'catalog:write');
    const key = this.requireKey(rawKey);
    const code = this.variantCode(input.code);
    const attributes = this.attributes(input.attributes);
    const data = { itemId, productCode: input.productCode, code, displayName: input.displayName?.trim() || code, attributesJson: attributes as Prisma.InputJsonValue };
    const hash = this.hash({ operation: 'ITEM_VARIANT_CREATE', ...data });
    try {
      return await this.prisma.$transaction(async (tx) => {
        const txContext = await this.authorization.requireModuleForProductInTransaction(tx, principal, organizationId, input.productCode, 'CATALOG', 'catalog:write');
        const replay = await this.findReceipt(tx, organizationId, principal.userId, 'ITEM_VARIANT_CREATE', key, hash);
        if (replay) return this.loadVariant(tx, organizationId, itemId, replay.resourceId);
        const item = await tx.item.findFirst({ where: { id: itemId, organizationId, active: true }, select: { id: true } });
        if (!item) throw new NotFoundException('Catalog item not found');
        const id = randomUUID();
        const variant = await tx.itemVariant.create({ data: { id, itemId, organizationId, code, displayName: data.displayName, attributesJson: data.attributesJson }, select: this.variantSelect });
        await this.createReceipt(tx, organizationId, principal.userId, 'ITEM_VARIANT_CREATE', key, hash, 'ItemVariant', id);
        await this.recordMutation(tx, txContext, principal, organizationId, id, 'CATALOG_VARIANT_CREATED', 'catalog.variant.created', { productCode: input.productCode, itemId, code });
        return this.serializeVariant(variant);
      });
    } catch (error) {
      if (this.isUniqueViolation(error)) return this.replayVariant(principal, organizationId, itemId, input.productCode, 'ITEM_VARIANT_CREATE', key, hash);
      throw error;
    }
  }

  async updateOffer(principal: AuthPrincipal, organizationId: string, offerId: string, input: UpdateCommercialOfferDto, rawKey: CatalogIdempotencyKey): Promise<unknown> {
    if (Object.keys(input).every((key) => key === 'expectedVersion')) throw new BadRequestException('At least one offer field is required');
    await this.authorization.requireMembership(principal, organizationId);
    const current = await this.prisma.commercialOffer.findFirst({ where: { id: offerId, organizationId }, select: this.offerSelect });
    if (!current) throw new NotFoundException('Commercial offer not found');
    if (!isProductCode(current.productCode)) throw new ConflictException('Offer has an unsupported product code');
    const productCode = current.productCode;
    const targetEstablishment = input.establishmentId === undefined ? current.establishmentId : input.establishmentId;
    const context = await this.authorize(principal, organizationId, productCode, 'catalog:write', current.establishmentId ?? undefined);
    if (targetEstablishment) await this.authorization.assertEstablishment(context, targetEstablishment);
    const key = this.requireKey(rawKey);
    const data = {
      expectedVersion: input.expectedVersion,
      establishmentId: input.establishmentId,
      channelCode: input.channelCode === undefined ? undefined : input.channelCode === null ? null : this.optionalCode(input.channelCode),
      displayName: input.displayName === undefined ? undefined : input.displayName === null ? null : input.displayName.trim(),
      status: input.status,
    };
    if (data.displayName === '') throw new BadRequestException('displayName cannot be blank');
    const hash = this.hash({ operation: 'COMMERCIAL_OFFER_UPDATE', offerId, data });
    try {
      return await this.prisma.$transaction(async (tx) => {
        const txContext = await this.authorization.requireModuleForProductInTransaction(tx, principal, organizationId, productCode, 'CATALOG', 'catalog:write');
        if (current.establishmentId) await this.assertEstablishmentInTransaction(tx, txContext, current.establishmentId);
        if (targetEstablishment) await this.assertEstablishmentInTransaction(tx, txContext, targetEstablishment);
        const replay = await this.findReceipt(tx, organizationId, principal.userId, 'COMMERCIAL_OFFER_UPDATE', key, hash);
        if (replay) return this.loadOffer(tx, organizationId, replay.resourceId);
        if (input.status === 'ACTIVE') {
          const activeSellUnit = await tx.measureUnit.findFirst({ where: { code: current.sellUnitCode, active: true }, select: { code: true } });
          if (!activeSellUnit) throw new ConflictException('An offer cannot be activated while its sell unit is inactive');
          const activeItem = await tx.item.findFirst({ where: { id: current.itemId, organizationId, active: true }, select: { id: true } });
          if (!activeItem) throw new ConflictException('An offer cannot be activated while its item is inactive');
          if (current.variantId) {
            const activeVariant = await tx.itemVariant.findFirst({ where: { id: current.variantId, itemId: current.itemId, organizationId, active: true }, select: { id: true } });
            if (!activeVariant) throw new ConflictException('An offer cannot be activated while its variant is inactive');
          }
        }
        const updated = await tx.commercialOffer.updateMany({
          where: { id: offerId, organizationId, productCode, version: input.expectedVersion },
          data: {
            ...(input.establishmentId !== undefined ? { establishmentId: input.establishmentId } : {}),
            ...(data.channelCode !== undefined ? { channelCode: data.channelCode } : {}),
            ...(data.displayName !== undefined ? { displayName: data.displayName } : {}),
            ...(input.status !== undefined ? { status: input.status } : {}),
            version: { increment: 1 },
          },
        });
        if (updated.count !== 1) throw new ConflictException('Commercial offer version changed');
        const offer = await tx.commercialOffer.findFirstOrThrow({ where: { id: offerId, organizationId }, select: this.offerSelect });
        await this.createReceipt(tx, organizationId, principal.userId, 'COMMERCIAL_OFFER_UPDATE', key, hash, 'CommercialOffer', offerId);
        const action: AuditAction = input.status !== undefined && input.status !== current.status ? 'CATALOG_OFFER_STATUS_CHANGED' : 'CATALOG_OFFER_UPDATED';
        const eventType = action === 'CATALOG_OFFER_STATUS_CHANGED' ? 'catalog.offer.status_changed' : 'catalog.offer.updated';
        await this.recordMutation(tx, txContext, principal, organizationId, offerId, action, eventType, { productCode: current.productCode, version: offer.version, establishmentId: offer.establishmentId, fields: Object.keys(input) });
        return this.serializeOffer(offer);
      });
    } catch (error) {
      if (this.isUniqueViolation(error)) return this.replayOffer(principal, organizationId, 'COMMERCIAL_OFFER_UPDATE', key, hash);
      throw error;
    }
  }

  private async authorize(principal: AuthPrincipal, organizationId: string, productCode: string, permission: 'catalog:read' | 'catalog:write', establishmentId?: string): Promise<ProductAuthorizationContext> {
    if (!isProductCode(productCode)) throw new BadRequestException('Product code is invalid');
    const context = await this.authorization.requireModuleForProduct(principal, organizationId, productCode, 'CATALOG', permission);
    if (establishmentId) await this.authorization.assertEstablishment(context, establishmentId);
    return context;
  }

  private async assertEstablishmentInTransaction(tx: Prisma.TransactionClient, context: ProductAuthorizationContext, establishmentId: string): Promise<void> {
    const establishment = await tx.establishment.findFirst({ where: { id: establishmentId, organizationId: context.organizationId, status: 'ACTIVE' }, select: { id: true } });
    if (!establishment || (context.scopeMode === 'SELECTED_ESTABLISHMENTS' && !context.establishmentIds.includes(establishmentId))) throw new ForbiddenException('Establishment access denied');
  }

  private async findReceipt(tx: Prisma.TransactionClient, organizationId: string, actorUserId: string, operation: string, key: string, hash: string): Promise<CommandReceipt | null> {
    const receipt = await tx.catalogCommandReceipt.findUnique({ where: { organizationId_actorUserId_operation_idempotencyKey: { organizationId, actorUserId, operation, idempotencyKey: key } }, select: { resourceType: true, resourceId: true, payloadHash: true } });
    if (!receipt) return null;
    if (receipt.payloadHash !== hash) throw new ConflictException('Idempotency-Key was already used for a different command');
    return receipt;
  }

  private async createReceipt(tx: Prisma.TransactionClient, organizationId: string, actorUserId: string, operation: string, key: string, hash: string, resourceType: string, resourceId: string): Promise<void> {
    await tx.catalogCommandReceipt.create({ data: { id: randomUUID(), organizationId, actorUserId, operation, idempotencyKey: key, payloadHash: hash, resourceType, resourceId } });
  }

  private async replayOffer(principal: AuthPrincipal, organizationId: string, operation: string, key: string, hash: string): Promise<unknown> {
    const receipt = await this.prisma.catalogCommandReceipt.findUnique({ where: { organizationId_actorUserId_operation_idempotencyKey: { organizationId, actorUserId: principal.userId, operation, idempotencyKey: key } }, select: { resourceType: true, resourceId: true, payloadHash: true } });
    if (!receipt || receipt.resourceType !== 'CommercialOffer' || receipt.payloadHash !== hash) throw new ConflictException('Idempotency-Key could not be replayed');
    const offer = await this.prisma.commercialOffer.findFirst({ where: { id: receipt.resourceId, organizationId }, select: this.offerSelect });
    if (!offer) throw new ConflictException('Idempotent catalog resource is no longer available');
    const context = await this.authorize(principal, organizationId, offer.productCode, 'catalog:write', offer.establishmentId ?? undefined);
    void context;
    return this.serializeOffer(offer);
  }

  private async replayVariant(principal: AuthPrincipal, organizationId: string, itemId: string, productCode: string, operation: string, key: string, hash: string): Promise<unknown> {
    const receipt = await this.prisma.catalogCommandReceipt.findUnique({ where: { organizationId_actorUserId_operation_idempotencyKey: { organizationId, actorUserId: principal.userId, operation, idempotencyKey: key } }, select: { resourceType: true, resourceId: true, payloadHash: true } });
    if (!receipt || receipt.resourceType !== 'ItemVariant' || receipt.payloadHash !== hash) throw new ConflictException('Idempotency-Key could not be replayed');
    const context = await this.authorize(principal, organizationId, productCode, 'catalog:write');
    void context;
    const variant = await this.prisma.itemVariant.findFirst({ where: { id: receipt.resourceId, itemId, organizationId }, select: this.variantSelect });
    if (!variant) throw new ConflictException('Idempotent catalog resource is no longer available');
    return this.serializeVariant(variant);
  }

  private async loadOffer(tx: Prisma.TransactionClient, organizationId: string, offerId: string) {
    const offer = await tx.commercialOffer.findFirst({ where: { id: offerId, organizationId }, select: this.offerSelect });
    if (!offer) throw new ConflictException('Idempotent catalog resource is no longer available');
    return this.serializeOffer(offer);
  }

  private async loadVariant(tx: Prisma.TransactionClient, organizationId: string, itemId: string, variantId: string) {
    const variant = await tx.itemVariant.findFirst({ where: { id: variantId, itemId, organizationId }, select: this.variantSelect });
    if (!variant) throw new ConflictException('Idempotent catalog resource is no longer available');
    return this.serializeVariant(variant);
  }

  private async recordMutation(tx: Prisma.TransactionClient, context: ProductAuthorizationContext, principal: AuthPrincipal, organizationId: string, id: string, action: AuditAction, eventType: string, payload: Record<string, unknown>): Promise<void> {
    const eventContext = currentEventContext();
    const request = eventContext?.requestId ? { requestId: eventContext.requestId, correlationId: eventContext.correlationId } : createRequestContext();
    await tx.auditEvent.create({ data: { id: randomUUID(), action, actorUserId: principal.userId, organizationId, ...(typeof payload.establishmentId === 'string' ? { establishmentId: payload.establishmentId } : {}), targetType: eventType.includes('variant') ? 'ItemVariant' : 'CommercialOffer', targetId: id, requestId: request.requestId, correlationId: request.correlationId, metadataJson: { productCode: context.productCode, ...payload } } });
    await this.outbox.enqueue(tx, createDomainEvent({ eventType, eventVersion: 1, occurredAt: new Date().toISOString(), actor: { type: 'USER', id: principal.userId }, aggregate: { type: eventType.includes('variant') ? 'ItemVariant' : 'CommercialOffer', id }, organizationId, ...(typeof payload.establishmentId === 'string' ? { establishmentId: payload.establishmentId } : {}), correlationId: request.correlationId, requestId: request.requestId, dataClassification: 'CONFIDENTIAL', purpose: 'commercial-catalog', payload: { productCode: context.productCode, ...payload } }));
  }

  private readonly offerSelect = { id: true, organizationId: true, productCode: true, itemId: true, variantId: true, establishmentId: true, channelCode: true, sellUnitCode: true, displayName: true, status: true, version: true, createdAt: true, updatedAt: true } as const;
  private readonly variantSelect = { id: true, organizationId: true, itemId: true, code: true, displayName: true, attributesJson: true, active: true, createdAt: true } as const;

  private serializeOffer(value: { id: string; organizationId: string; productCode: string; itemId: string; variantId: string | null; establishmentId: string | null; channelCode: string | null; sellUnitCode: string; displayName: string | null; status: CommercialOfferStatus; version: number; createdAt: Date; updatedAt: Date }): unknown {
    return { id: value.id, organizationId: value.organizationId, productCode: value.productCode, itemId: value.itemId, variantId: value.variantId, establishmentId: value.establishmentId, channelCode: value.channelCode, sellUnitCode: value.sellUnitCode, displayName: value.displayName, status: value.status, version: value.version, createdAt: value.createdAt.toISOString(), updatedAt: value.updatedAt.toISOString() };
  }

  private serializeVariant(value: { id: string; organizationId: string; itemId: string; code: string; displayName: string; attributesJson: Prisma.JsonValue; active: boolean }): unknown {
    return { id: value.id, organizationId: value.organizationId, itemId: value.itemId, code: value.code, displayName: value.displayName, attributes: value.attributesJson, status: value.active ? 'ACTIVE' : 'INACTIVE' };
  }

  private optionalCode(value?: string | null): string | null { return value == null ? null : this.code(value, 48, 'channelCode'); }
  private code(value: string, max: number, field: string): string {
    const normalized = value.trim().toUpperCase();
    if (normalized.length > max || !/^[A-Z][A-Z0-9_]*$/.test(normalized)) throw new BadRequestException(`${field} is invalid`);
    return normalized;
  }
  private variantCode(value: string): string {
    const normalized = value.trim().toUpperCase();
    if (normalized.length > 64 || !/^[A-Z0-9][A-Z0-9._-]*$/.test(normalized)) throw new BadRequestException('Variant code is invalid');
    return normalized;
  }
  private attributes(value?: Record<string, string>): Record<string, string> {
    const entries = Object.entries(value ?? {});
    if (entries.length > 30 || entries.some(([key, item]) => !/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(key) || typeof item !== 'string' || item.length > 256)) throw new BadRequestException('Variant attributes are invalid');
    return Object.fromEntries(entries.sort(([a], [b]) => a.localeCompare(b)));
  }
  private requireKey(value?: string): string {
    if (!value?.trim() || value.length > 200 || /[\r\n]/.test(value)) throw new BadRequestException('Idempotency-Key is required and invalid');
    return value.trim();
  }
  private hash(value: unknown): string { return createHash('sha256').update(JSON.stringify(this.canonical(value))).digest('hex'); }
  private canonical(value: unknown): unknown {
    if (Array.isArray(value)) return value.map((item) => this.canonical(item));
    if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, this.canonical(item)]));
    return value;
  }
  private isUniqueViolation(error: unknown): boolean { return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'; }
  private encodeCursor(value: Cursor): string { return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url'); }
  private decodeCursor(value: string): Cursor {
    try {
      const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Partial<Cursor>;
      if (typeof parsed.createdAt !== 'string' || Number.isNaN(Date.parse(parsed.createdAt)) || typeof parsed.id !== 'string') throw new Error('invalid');
      return { createdAt: parsed.createdAt, id: parsed.id };
    } catch { throw new BadRequestException('Cursor is invalid'); }
  }
}
