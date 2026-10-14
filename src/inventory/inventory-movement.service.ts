import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type AuditAction, type InventoryMovementType } from '@prisma/client';
import { PrismaService } from '../database/prisma.service.js';
import { createDomainEvent } from '../events/domain-event.factory.js';
import { createRequestContext, currentEventContext } from '../events/event-context.js';
import { PrismaOutboxWriter } from '../events/prisma-outbox.writer.js';
import type { AuthPrincipal } from '../auth/auth.types.js';
import { AuthorizationService } from '../tenancy/authorization.service.js';
import type { InventoryListQuery, InventoryMovementCommand } from './inventory.dto.js';
import { assertInventoryMovementReplayCompatible } from './inventory-idempotency.js';

const OUT_MOVEMENTS: readonly InventoryMovementType[] = ['SALE_OUT', 'ADJUSTMENT_OUT', 'TRANSFER_OUT'];

@Injectable()
export class InventoryMovementService {
  constructor(private readonly prisma: PrismaService, private readonly authorization: AuthorizationService, private readonly outbox: PrismaOutboxWriter) {}

  async create(principal: AuthPrincipal, organizationId: string, input: InventoryMovementCommand, rawIdempotencyKey: string): Promise<unknown> {
    const context = await this.authorization.requireModule(principal, organizationId, 'INVENTORY', 'inventory:write');
    await this.authorization.assertEstablishment(context, input.establishmentId);
    if (input.movementType === 'TRANSFER_IN' || input.movementType === 'TRANSFER_OUT' || input.sourceType === 'TRANSFER') {
      throw new BadRequestException('Transfer movements must be created atomically through the transfer endpoint');
    }
    const idempotencyKey = this.requireIdempotencyKey(rawIdempotencyKey);
    const quantity = this.parseQuantity(input.quantity);
    const delta = OUT_MOVEMENTS.includes(input.movementType) ? quantity.negated() : quantity;
    const eventContext = currentEventContext();
    const event = eventContext?.requestId ? { requestId: eventContext.requestId, correlationId: eventContext.correlationId } : createRequestContext();

    try {
      return await this.prisma.$transaction(async (tx) => {
        const replay = await tx.inventoryMovement.findUnique({ where: { organizationId_idempotencyKey: { organizationId, idempotencyKey } }, select: this.select });
        if (replay) {
          assertInventoryMovementReplayCompatible(replay, input);
          return this.serialize(replay);
        }

        await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${organizationId}:${input.warehouseId}:${input.itemId}`}, 0))`);
        const warehouse = await tx.warehouse.findFirst({ where: { id: input.warehouseId, organizationId, establishmentId: input.establishmentId, active: true }, select: { id: true } });
        const item = await tx.item.findFirst({ where: { id: input.itemId, organizationId, active: true, trackInventory: true }, select: { id: true } });
        if (!warehouse || !item) throw new NotFoundException('Inventory warehouse or item not found');

        const balance = await tx.inventoryBalance.findUnique({ where: { organizationId_warehouseId_itemId: { organizationId, warehouseId: input.warehouseId, itemId: input.itemId } } });
        const nextQuantity = (balance?.quantity ?? new Prisma.Decimal(0)).add(delta);
        if (nextQuantity.lt(0)) throw new ConflictException('Insufficient inventory');
        if (nextQuantity.gte(new Prisma.Decimal(1000000000000))) throw new BadRequestException('Inventory balance exceeds supported range');

        const movementId = randomUUID();
        const movement = await tx.inventoryMovement.create({
          data: {
            id: movementId,
            organizationId,
            establishmentId: input.establishmentId,
            warehouseId: input.warehouseId,
            itemId: input.itemId,
            movementType: input.movementType,
            sourceType: input.sourceType,
            quantityDelta: delta.toFixed(6),
            sourceId: input.sourceId ?? null,
            sourceLineId: input.sourceLineId ?? null,
            sourceRevision: input.sourceRevision ?? (input.sourceId && input.sourceLineId ? 'LEGACY' : null),
            transferId: input.transferId ?? null,
            idempotencyKey,
            reason: input.reason?.trim() || null,
            occurredAt: input.occurredAt ? new Date(input.occurredAt) : new Date(),
            createdByUserId: principal.userId,
          },
          select: this.select,
        });
        await tx.inventoryBalance.upsert({
          where: { organizationId_warehouseId_itemId: { organizationId, warehouseId: input.warehouseId, itemId: input.itemId } },
          create: { organizationId, warehouseId: input.warehouseId, itemId: input.itemId, quantity: nextQuantity.toFixed(6) },
          update: { quantity: nextQuantity.toFixed(6) },
        });
        await this.recordMutation(tx, 'INVENTORY_MOVEMENT_CREATED', principal, organizationId, input.establishmentId, movementId, event, {
          movementType: input.movementType,
          sourceType: input.sourceType,
          quantityDelta: delta.toFixed(6),
          warehouseId: input.warehouseId,
          itemId: input.itemId,
          balanceAfter: nextQuantity.toFixed(6),
        });
        return this.serialize(movement);
      }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const existing = await this.prisma.inventoryMovement.findUnique({ where: { organizationId_idempotencyKey: { organizationId, idempotencyKey } }, select: this.select });
        if (existing) {
          assertInventoryMovementReplayCompatible(existing, input);
          return this.serialize(existing);
        }
      }
      throw error;
    }
  }

  async list(principal: AuthPrincipal, organizationId: string, query: InventoryListQuery): Promise<unknown> {
    const context = await this.authorization.requireModule(principal, organizationId, 'INVENTORY', 'inventory:read');
    if (query.establishmentId) await this.authorization.assertEstablishment(context, query.establishmentId);
    const establishmentIds = query.establishmentId ? [query.establishmentId] : context.scopeMode === 'SELECTED_ESTABLISHMENTS' ? Array.from(context.establishmentIds) : undefined;
    const limit = query.limit ?? 20;
    const cursor = query.cursor ? this.decodeCursor(query.cursor) : undefined;
    const rows = await this.prisma.inventoryMovement.findMany({
      where: {
        organizationId,
        ...(establishmentIds ? { establishmentId: { in: establishmentIds } } : {}),
        ...(query.warehouseId ? { warehouseId: query.warehouseId } : {}),
        ...(query.itemId ? { itemId: query.itemId } : {}),
        ...(cursor ? { OR: [{ occurredAt: { gt: new Date(cursor.occurredAt) } }, { occurredAt: new Date(cursor.occurredAt), id: { gt: cursor.id } }] } : {}),
      },
      orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
      take: limit + 1,
      select: this.select,
    });
    const items = rows.slice(0, limit).map((row) => this.serialize(row));
    const next = rows.length > limit ? rows[limit - 1] : undefined;
    return { items, nextCursor: next ? this.encodeCursor({ occurredAt: next.occurredAt.toISOString(), id: next.id }) : null };
  }

  private async recordMutation(tx: Prisma.TransactionClient, action: AuditAction, principal: AuthPrincipal, organizationId: string, establishmentId: string, movementId: string, context: { requestId: string; correlationId: string }, payload: Record<string, unknown>): Promise<void> {
    await tx.auditEvent.create({ data: { id: randomUUID(), action, actorUserId: principal.userId, organizationId, establishmentId, targetType: 'InventoryMovement', targetId: movementId, requestId: context.requestId, correlationId: context.correlationId, metadataJson: payload as Prisma.InputJsonValue } });
    await this.outbox.enqueue(tx, createDomainEvent({ eventType: 'inventory.movement.created', eventVersion: 1, occurredAt: new Date().toISOString(), actor: { type: 'USER', id: principal.userId }, aggregate: { type: 'InventoryMovement', id: movementId }, organizationId, establishmentId, correlationId: context.correlationId, requestId: context.requestId, dataClassification: 'CONFIDENTIAL', purpose: 'inventory-ledger', payload }));
  }

  private parseQuantity(value: string): Prisma.Decimal {
    const quantity = new Prisma.Decimal(value);
    if (!quantity.gt(0) || quantity.decimalPlaces() > 6 || quantity.gte(new Prisma.Decimal('1000000000000'))) throw new BadRequestException('Quantity must be positive and have at most six decimal places');
    return quantity;
  }

  private requireIdempotencyKey(value: string): string { if (!value?.trim() || value.length > 200) throw new BadRequestException('Idempotency-Key is required'); return value.trim(); }

  private encodeCursor(cursor: { occurredAt: string; id: string }): string { return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url'); }

  private decodeCursor(value: string): { occurredAt: string; id: string } {
    try {
      const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as { occurredAt?: string; id?: string };
      if (!parsed.occurredAt || !parsed.id || Number.isNaN(Date.parse(parsed.occurredAt))) throw new Error();
      return { occurredAt: parsed.occurredAt, id: parsed.id };
    } catch {
      throw new BadRequestException('Cursor is invalid');
    }
  }

  private readonly select = { id: true, organizationId: true, establishmentId: true, warehouseId: true, itemId: true, movementType: true, sourceType: true, quantityDelta: true, sourceId: true, sourceLineId: true, sourceRevision: true, transferId: true, idempotencyKey: true, reason: true, occurredAt: true, createdByUserId: true, createdAt: true } as const;

  private serialize(row: { id: string; organizationId: string; establishmentId: string; warehouseId: string; itemId: string; movementType: InventoryMovementType; sourceType: string; quantityDelta: Prisma.Decimal; sourceId: string | null; sourceLineId: string | null; sourceRevision: string | null; transferId: string | null; idempotencyKey: string | null; reason: string | null; occurredAt: Date; createdByUserId: string; createdAt: Date }): unknown {
    return { ...row, quantityDelta: row.quantityDelta.toFixed(6), occurredAt: row.occurredAt.toISOString(), createdAt: row.createdAt.toISOString() };
  }
}
