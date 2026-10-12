import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type AuditAction } from '@prisma/client';
import { PrismaService } from '../database/prisma.service.js';
import { createDomainEvent } from '../events/domain-event.factory.js';
import { createRequestContext, currentEventContext } from '../events/event-context.js';
import { PrismaOutboxWriter } from '../events/prisma-outbox.writer.js';
import type { AuthPrincipal } from '../auth/auth.types.js';
import { AuthorizationService } from '../tenancy/authorization.service.js';
import type { CreateItemDto, ItemListQuery, UpdateItemDto } from './item.dto.js';

type ItemCursor = { createdAt: string; id: string };

@Injectable()
export class ItemService {
  constructor(private readonly prisma: PrismaService, private readonly authorization: AuthorizationService, private readonly outbox: PrismaOutboxWriter) {}

  async list(principal: AuthPrincipal, organizationId: string, query: ItemListQuery): Promise<unknown> {
    await this.authorization.requireModule(principal, organizationId, 'CATALOG', 'catalog:read');
    const limit = query.limit ?? 20;
    const cursor = query.cursor ? this.decodeCursor(query.cursor) : undefined;
    const rows = await this.prisma.item.findMany({
      where: {
        organizationId,
        ...(query.type ? { type: query.type } : {}),
        active: query.active ?? true,
        ...(query.search ? { name: { contains: query.search.trim(), mode: 'insensitive' } } : {}),
        ...(cursor ? { OR: [{ createdAt: { gt: new Date(cursor.createdAt) } }, { createdAt: new Date(cursor.createdAt), id: { gt: cursor.id } }] } : {}),
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: limit + 1,
      select: this.select,
    });
    const items = rows.slice(0, limit).map((item) => this.serialize(item));
    const next = rows.length > limit ? rows[limit - 1] : undefined;
    return { items, nextCursor: next ? this.encodeCursor({ createdAt: next.createdAt.toISOString(), id: next.id }) : null };
  }

  async get(principal: AuthPrincipal, organizationId: string, itemId: string): Promise<unknown> {
    await this.authorization.requireModule(principal, organizationId, 'CATALOG', 'catalog:read');
    const item = await this.prisma.item.findFirst({ where: { id: itemId, organizationId }, select: this.select });
    if (!item) throw new NotFoundException();
    return this.serialize(item);
  }

  async create(principal: AuthPrincipal, organizationId: string, input: CreateItemDto): Promise<unknown> {
    await this.authorization.requireModule(principal, organizationId, 'CATALOG', 'catalog:write');
    const id = randomUUID();
    const eventContext = currentEventContext();
    const context = eventContext?.requestId ? { requestId: eventContext.requestId, correlationId: eventContext.correlationId } : createRequestContext();
    return this.prisma.$transaction(async (tx) => {
      const item = await tx.item.create({
        data: {
          id,
          organizationId,
          type: input.type,
          ...(input.sku !== undefined ? { sku: this.normalizeSku(input.sku) } : {}),
          name: input.name.trim(),
          ...(input.description !== undefined ? { description: input.description.trim() } : {}),
          unit: input.unit.trim(),
          referencePrice: input.referencePrice,
          currency: input.currency.toUpperCase(),
          ...(input.trackInventory !== undefined ? { trackInventory: input.trackInventory } : {}),
        },
        select: this.select,
      });
      await this.recordMutation(tx, 'CATALOG_ITEM_CREATED', 'catalog.item.created', principal, organizationId, id, context, { type: item.type, name: item.name, sku: item.sku });
      return this.serialize(item);
    }).catch((error: unknown) => {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('Item SKU conflicts with an existing record');
      throw error;
    });
  }

  async update(principal: AuthPrincipal, organizationId: string, itemId: string, input: UpdateItemDto): Promise<unknown> {
    await this.authorization.requireModule(principal, organizationId, 'CATALOG', 'catalog:write');
    if (Object.keys(input).length === 0) throw new BadRequestException('At least one item field is required');
    const current = await this.prisma.item.findFirst({ where: { id: itemId, organizationId }, select: { id: true } });
    if (!current) throw new NotFoundException();
    const eventContext = currentEventContext();
    const context = eventContext?.requestId ? { requestId: eventContext.requestId, correlationId: eventContext.correlationId } : createRequestContext();
    return this.prisma.$transaction(async (tx) => {
      const item = await tx.item.update({
        where: { id: itemId },
        data: {
          ...(input.type !== undefined ? { type: input.type } : {}),
          ...(input.sku !== undefined ? { sku: input.sku === null ? null : this.normalizeSku(input.sku) } : {}),
          ...(input.name !== undefined ? { name: input.name.trim() } : {}),
          ...(input.description !== undefined ? { description: input.description === null ? null : input.description.trim() } : {}),
          ...(input.unit !== undefined ? { unit: input.unit.trim() } : {}),
          ...(input.referencePrice !== undefined ? { referencePrice: input.referencePrice } : {}),
          ...(input.currency !== undefined ? { currency: input.currency.toUpperCase() } : {}),
          ...(input.trackInventory !== undefined ? { trackInventory: input.trackInventory } : {}),
        },
        select: this.select,
      });
      await this.recordMutation(tx, 'CATALOG_ITEM_UPDATED', 'catalog.item.updated', principal, organizationId, itemId, context, { fields: Object.keys(input) });
      return this.serialize(item);
    }).catch((error: unknown) => {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('Item SKU conflicts with an existing record');
      throw error;
    });
  }

  async setActive(principal: AuthPrincipal, organizationId: string, itemId: string, active: boolean): Promise<unknown> {
    await this.authorization.requireModule(principal, organizationId, 'CATALOG', 'catalog:write');
    const eventContext = currentEventContext();
    const context = eventContext?.requestId ? { requestId: eventContext.requestId, correlationId: eventContext.correlationId } : createRequestContext();
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.item.findFirst({ where: { id: itemId, organizationId }, select: this.select });
      if (!current) throw new NotFoundException();
      if (current.active === active) return this.serialize(current);
      const changed = await tx.item.updateMany({ where: { id: itemId, organizationId, active: !active }, data: { active } });
      if (changed.count === 0) {
        const latest = await tx.item.findFirst({ where: { id: itemId, organizationId }, select: this.select });
        if (!latest) throw new NotFoundException();
        return this.serialize(latest);
      }
      const item = await tx.item.findFirstOrThrow({ where: { id: itemId, organizationId }, select: this.select });
      await this.recordMutation(tx, 'CATALOG_ITEM_STATUS_CHANGED', 'catalog.item.status_changed', principal, organizationId, itemId, context, { active });
      return this.serialize(item);
    });
  }

  private async recordMutation(tx: Prisma.TransactionClient, action: AuditAction, eventType: string, principal: AuthPrincipal, organizationId: string, itemId: string, context: { requestId: string; correlationId: string }, payload: Record<string, unknown>): Promise<void> {
    await tx.auditEvent.create({ data: { id: randomUUID(), action, actorUserId: principal.userId, organizationId, targetType: 'Item', targetId: itemId, requestId: context.requestId, correlationId: context.correlationId, metadataJson: payload as Prisma.InputJsonValue } });
    await this.outbox.enqueue(tx, createDomainEvent({ eventType, eventVersion: 1, occurredAt: new Date().toISOString(), actor: { type: 'USER', id: principal.userId }, aggregate: { type: 'Item', id: itemId }, organizationId, correlationId: context.correlationId, requestId: context.requestId, dataClassification: 'CONFIDENTIAL', purpose: 'catalog-item-referential', payload }));
  }

  private readonly select = { id: true, organizationId: true, type: true, sku: true, name: true, description: true, unit: true, referencePrice: true, currency: true, trackInventory: true, active: true, createdAt: true, updatedAt: true } as const;

  private serialize(item: { id: string; organizationId: string; type: string; sku: string | null; name: string; description: string | null; unit: string; referencePrice: Prisma.Decimal; currency: string; trackInventory: boolean; active: boolean; createdAt: Date; updatedAt: Date }): unknown {
    return { ...item, referencePrice: item.referencePrice.toFixed(4), createdAt: item.createdAt.toISOString(), updatedAt: item.updatedAt.toISOString() };
  }

  private normalizeSku(value: string): string { return value.trim().toUpperCase(); }

  private encodeCursor(cursor: ItemCursor): string { return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url'); }

  private decodeCursor(value: string): ItemCursor {
    try {
      const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Partial<ItemCursor>;
      if (typeof parsed.createdAt !== 'string' || typeof parsed.id !== 'string' || Number.isNaN(Date.parse(parsed.createdAt))) throw new Error('invalid');
      return { createdAt: parsed.createdAt, id: parsed.id };
    } catch {
      throw new BadRequestException('Cursor is invalid');
    }
  }
}
