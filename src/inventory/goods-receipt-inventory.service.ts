import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type AuditAction, type GoodsReceiptInventoryLinkStatus } from '@prisma/client';
import { PrismaService } from '../database/prisma.service.js';
import { createDomainEvent } from '../events/domain-event.factory.js';
import { createRequestContext, currentEventContext } from '../events/event-context.js';
import { PrismaOutboxWriter } from '../events/prisma-outbox.writer.js';
import type { AuthPrincipal } from '../auth/auth.types.js';
import { AuthorizationService } from '../tenancy/authorization.service.js';
import type { GoodsReceiptInventoryAssignmentDto, GoodsReceiptInventoryImportDto, PendingGoodsReceiptInventoryQuery } from './goods-receipt-inventory.dto.js';

type EventContext = { requestId: string; correlationId: string };

@Injectable()
export class GoodsReceiptInventoryService {
  constructor(private readonly prisma: PrismaService, private readonly authorization: AuthorizationService, private readonly outbox: PrismaOutboxWriter) {}

  async listPending(principal: AuthPrincipal, organizationId: string, query: PendingGoodsReceiptInventoryQuery): Promise<unknown> {
    const context = await this.authorization.requireModule(principal, organizationId, 'INVENTORY', 'inventory:read');
    if (query.establishmentId) await this.authorization.assertEstablishment(context, query.establishmentId);
    const limit = query.limit ?? 20;
    const cursor = query.cursor ? this.decodeCursor(query.cursor) : undefined;
    const rows = await this.prisma.goodsReceiptInventoryLink.findMany({
      where: {
        organizationId,
        status: 'PENDING_ASSIGNMENT',
        ...(query.establishmentId ? { establishmentId: query.establishmentId } : {}),
        ...(cursor ? { OR: [{ createdAt: { gt: new Date(cursor.createdAt) } }, { createdAt: new Date(cursor.createdAt), id: { gt: cursor.id } }] } : {}),
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: limit + 1,
      select: this.select,
    });
    const items = rows.slice(0, limit).map((row) => this.serialize(row));
    const next = rows.length > limit ? rows[limit] : undefined;
    return { items, nextCursor: next ? this.encodeCursor({ createdAt: next.createdAt.toISOString(), id: next.id }) : null };
  }

  async assign(principal: AuthPrincipal, organizationId: string, goodsReceiptId: string, input: GoodsReceiptInventoryAssignmentDto, idempotencyKey: string | undefined): Promise<unknown> {
    const context = await this.authorization.requireModule(principal, organizationId, 'INVENTORY', 'inventory:write');
    await this.authorization.assertEstablishment(context, input.establishmentId);
    const key = this.requireKey(idempotencyKey);
    const event = this.eventContext();
    return this.prisma.$transaction(async (tx) => {
      const receipt = await this.receipt(tx, organizationId, goodsReceiptId);
      if (receipt.establishmentId !== input.establishmentId) throw new ConflictException('Receipt establishment does not match assignment');
      if (receipt.status !== 'CONFIRMED') throw new ConflictException('Only a confirmed receipt can be assigned to Inventory');
      const link = await tx.goodsReceiptInventoryLink.findUnique({ where: { goodsReceiptId_organizationId: { goodsReceiptId, organizationId } }, select: this.linkSelect });
      if (!link) throw new NotFoundException('Goods receipt inventory link not found; use historical import when no event is available');
      if (link.status !== 'PENDING_ASSIGNMENT') {
        if (link.warehouseId !== input.warehouseId) throw new ConflictException('Goods receipt is already assigned to another warehouse');
        return this.serialize(link);
      }
      const warehouse = await tx.warehouse.findFirst({ where: { id: input.warehouseId, organizationId, establishmentId: input.establishmentId, active: true }, select: { id: true } });
      if (!warehouse) throw new NotFoundException('Active warehouse not found');
      const updated = await tx.goodsReceiptInventoryLink.update({ where: { id: link.id }, data: { status: 'ASSIGNED', warehouseId: input.warehouseId, decisionSource: 'EVENT_ASSIGNMENT', reason: this.requireReason(input.reason), assignedByUserId: principal.userId, assignedAt: new Date(), idempotencyKey: key }, select: this.linkSelect });
      await this.applyEntries(tx, organizationId, updated, receipt, principal.userId, event, input.reason);
      await this.recordLinkMutation(tx, 'GOODS_RECEIPT_INVENTORY_ASSIGNED', 'inventory.goods_receipt.assigned', principal, organizationId, receipt.establishmentId, updated.id, event, { goodsReceiptId, warehouseId: input.warehouseId, reason: input.reason.trim() });
      return this.serialize(updated);
    });
  }

  async importHistorical(principal: AuthPrincipal, organizationId: string, goodsReceiptId: string, input: GoodsReceiptInventoryImportDto, idempotencyKey: string | undefined): Promise<unknown> {
    const context = await this.authorization.requireModule(principal, organizationId, 'INVENTORY', 'inventory:write');
    await this.authorization.assertEstablishment(context, input.establishmentId);
    const key = this.requireKey(idempotencyKey);
    const event = this.eventContext();
    return this.prisma.$transaction(async (tx) => {
      const receipt = await this.receipt(tx, organizationId, goodsReceiptId);
      if (receipt.establishmentId !== input.establishmentId) throw new ConflictException('Receipt establishment does not match import');
      if (receipt.status !== 'CONFIRMED') throw new ConflictException('Only a confirmed receipt can be imported into Inventory');
      const existing = await tx.goodsReceiptInventoryLink.findUnique({ where: { goodsReceiptId_organizationId: { goodsReceiptId, organizationId } }, select: this.linkSelect });
      if (existing?.status === 'IMPORTED') return this.serialize(existing);
      if (existing?.status === 'ASSIGNED') {
        if (existing.warehouseId !== input.warehouseId) throw new ConflictException('Goods receipt is already assigned to another warehouse');
        return this.serialize(existing);
      }
      if (existing && (await tx.goodsReceiptInventoryEntry.count({ where: { organizationId, goodsReceiptId, sourceEventId: { not: null } } })) > 0) throw new ConflictException('An event-backed receipt cannot be imported historically');
      const warehouse = await tx.warehouse.findFirst({ where: { id: input.warehouseId, organizationId, establishmentId: input.establishmentId, active: true }, select: { id: true } });
      if (!warehouse) throw new NotFoundException('Active warehouse not found');
      const link = existing
        ? await tx.goodsReceiptInventoryLink.update({ where: { id: existing.id }, data: { status: 'IMPORTED', warehouseId: input.warehouseId, sourceRevision: 'HISTORICAL_IMPORT', decisionSource: 'HISTORICAL_IMPORT', reason: this.requireReason(input.reason), assignedByUserId: principal.userId, assignedAt: new Date(), idempotencyKey: key }, select: this.linkSelect })
        : await tx.goodsReceiptInventoryLink.create({ data: { id: randomUUID(), organizationId, establishmentId: receipt.establishmentId, goodsReceiptId, warehouseId: input.warehouseId, status: 'IMPORTED', sourceRevision: 'HISTORICAL_IMPORT', decisionSource: 'HISTORICAL_IMPORT', reason: this.requireReason(input.reason), assignedByUserId: principal.userId, assignedAt: new Date(), idempotencyKey: key }, select: this.linkSelect });
      const historicalEntryCount = await tx.goodsReceiptInventoryEntry.count({ where: { organizationId, goodsReceiptId, sourceRevision: 'HISTORICAL_IMPORT' } });
      if (historicalEntryCount === 0) {
        await tx.goodsReceiptInventoryEntry.createMany({ data: receipt.lines.map((line) => ({ id: randomUUID(), organizationId, linkId: link.id, goodsReceiptId, goodsReceiptLineId: line.id, itemId: line.itemId, sourceRevision: 'HISTORICAL_IMPORT', deltaQuantity: line.quantity.toFixed(6) })) });
      }
      await this.applyEntries(tx, organizationId, link, receipt, principal.userId, event, input.reason);
      await this.recordLinkMutation(tx, 'GOODS_RECEIPT_INVENTORY_IMPORTED', 'inventory.goods_receipt.imported', principal, organizationId, receipt.establishmentId, link.id, event, { goodsReceiptId, warehouseId: input.warehouseId, reason: input.reason.trim(), sourceRevision: 'HISTORICAL_IMPORT' });
      return this.serialize(link);
    });
  }

  private async applyEntries(tx: Prisma.TransactionClient, organizationId: string, link: { id: string; warehouseId: string | null }, receipt: { id: string; establishmentId: string; receivedAt: Date }, actorUserId: string, event: EventContext, reason: string): Promise<void> {
    if (!link.warehouseId) throw new ConflictException('Goods receipt inventory link has no warehouse');
    const entries = await tx.goodsReceiptInventoryEntry.findMany({ where: { organizationId, linkId: link.id, inventoryMovementId: null }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
    for (const entry of entries) {
      if (!entry.itemId) throw new ConflictException('Goods receipt line has no inventory-tracked item');
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${organizationId}:${link.warehouseId}:${entry.itemId}`}, 0))`);
      const warehouse = await tx.warehouse.findFirst({ where: { id: link.warehouseId, organizationId, establishmentId: receipt.establishmentId, active: true }, select: { id: true } });
      const item = await tx.item.findFirst({ where: { id: entry.itemId, organizationId, active: true, trackInventory: true }, select: { id: true } });
      if (!warehouse || !item) throw new NotFoundException('Inventory warehouse or item not found');
      const balance = await tx.inventoryBalance.findUnique({ where: { organizationId_warehouseId_itemId: { organizationId, warehouseId: link.warehouseId, itemId: entry.itemId } } });
      const next = (balance?.quantity ?? new Prisma.Decimal(0)).add(entry.deltaQuantity);
      if (next.lt(0)) throw new ConflictException('Goods receipt correction would make inventory negative');
      const movementId = randomUUID();
      const movementType = entry.deltaQuantity.gt(0) ? 'RECEIPT_IN' : 'ADJUSTMENT_OUT';
      await tx.inventoryMovement.create({ data: { id: movementId, organizationId, establishmentId: receipt.establishmentId, warehouseId: link.warehouseId, itemId: entry.itemId, movementType, sourceType: 'GOODS_RECEIPT', quantityDelta: entry.deltaQuantity.toFixed(6), sourceId: receipt.id, sourceLineId: entry.goodsReceiptLineId, sourceRevision: entry.sourceRevision, idempotencyKey: `goods-receipt-inventory:${entry.id}`, reason: reason.trim(), occurredAt: receipt.receivedAt, createdByUserId: actorUserId } });
      await tx.inventoryBalance.upsert({ where: { organizationId_warehouseId_itemId: { organizationId, warehouseId: link.warehouseId, itemId: entry.itemId } }, create: { organizationId, warehouseId: link.warehouseId, itemId: entry.itemId, quantity: next.toFixed(6) }, update: { quantity: next.toFixed(6) } });
      await tx.goodsReceiptInventoryEntry.update({ where: { id: entry.id }, data: { inventoryMovementId: movementId } });
      await tx.auditEvent.create({ data: { id: randomUUID(), action: 'INVENTORY_MOVEMENT_CREATED', actorUserId, organizationId, establishmentId: receipt.establishmentId, targetType: 'InventoryMovement', targetId: movementId, requestId: event.requestId, correlationId: event.correlationId, metadataJson: { movementType, sourceType: 'GOODS_RECEIPT', sourceRevision: entry.sourceRevision, goodsReceiptId: receipt.id, goodsReceiptLineId: entry.goodsReceiptLineId, quantityDelta: entry.deltaQuantity.toFixed(6), warehouseId: link.warehouseId, itemId: entry.itemId, balanceAfter: next.toFixed(6) } } });
      await this.outbox.enqueue(tx, createDomainEvent({ eventType: 'inventory.movement.created', eventVersion: 1, occurredAt: new Date().toISOString(), actor: { type: 'USER', id: actorUserId }, aggregate: { type: 'InventoryMovement', id: movementId }, organizationId, establishmentId: receipt.establishmentId, correlationId: event.correlationId, causationId: event.requestId, requestId: event.requestId, dataClassification: 'CONFIDENTIAL', purpose: 'inventory-ledger', payload: { movementType, sourceType: 'GOODS_RECEIPT', sourceRevision: entry.sourceRevision, goodsReceiptId: receipt.id, goodsReceiptLineId: entry.goodsReceiptLineId, quantityDelta: entry.deltaQuantity.toFixed(6), warehouseId: link.warehouseId, itemId: entry.itemId, balanceAfter: next.toFixed(6) } }));
    }
  }

  private async recordLinkMutation(tx: Prisma.TransactionClient, action: AuditAction, eventType: string, principal: AuthPrincipal, organizationId: string, establishmentId: string, linkId: string, event: EventContext, payload: Record<string, unknown>): Promise<void> {
    await tx.auditEvent.create({ data: { id: randomUUID(), action, actorUserId: principal.userId, organizationId, establishmentId, targetType: 'GoodsReceiptInventoryLink', targetId: linkId, requestId: event.requestId, correlationId: event.correlationId, metadataJson: payload as Prisma.InputJsonValue } });
    await this.outbox.enqueue(tx, createDomainEvent({ eventType, eventVersion: 1, occurredAt: new Date().toISOString(), actor: { type: 'USER', id: principal.userId }, aggregate: { type: 'GoodsReceiptInventoryLink', id: linkId }, organizationId, establishmentId, correlationId: event.correlationId, requestId: event.requestId, dataClassification: 'CONFIDENTIAL', purpose: 'inventory-goods-receipt', payload }));
  }

  private async receipt(tx: Prisma.TransactionClient, organizationId: string, goodsReceiptId: string): Promise<{ id: string; establishmentId: string; status: 'DRAFT' | 'CONFIRMED' | 'CANCELLED'; receivedAt: Date; lines: Array<{ id: string; itemId: string | null; quantity: Prisma.Decimal }> }> {
    const receipt = await tx.goodsReceipt.findFirst({ where: { id: goodsReceiptId, organizationId }, select: { id: true, establishmentId: true, status: true, receivedAt: true, lines: { orderBy: { lineIndex: 'asc' }, select: { id: true, itemId: true, quantity: true } } } });
    if (!receipt) throw new NotFoundException('Goods receipt not found');
    return receipt;
  }

  private readonly select = { id: true, organizationId: true, establishmentId: true, goodsReceiptId: true, warehouseId: true, status: true, sourceRevision: true, createdAt: true, updatedAt: true } as const;
  private readonly linkSelect = { id: true, organizationId: true, establishmentId: true, goodsReceiptId: true, warehouseId: true, status: true, sourceRevision: true, createdAt: true, updatedAt: true } as const;
  private serialize(row: { id: string; organizationId: string; establishmentId: string; goodsReceiptId: string; warehouseId: string | null; status: GoodsReceiptInventoryLinkStatus; sourceRevision: string; createdAt: Date; updatedAt: Date }): unknown { return { ...row, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() }; }
  private eventContext(): EventContext { const current = currentEventContext(); return current?.requestId ? { requestId: current.requestId, correlationId: current.correlationId } : createRequestContext(); }
  private requireKey(value: string | undefined): string { if (!value?.trim() || value.length > 200 || /[\r\n]/.test(value)) throw new BadRequestException('Idempotency-Key is required and invalid'); return value.trim(); }
  private requireReason(value: string): string { const reason = value.trim(); if (!reason) throw new BadRequestException('Reason is required'); return reason; }
  private encodeCursor(cursor: { createdAt: string; id: string }): string { return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url'); }
  private decodeCursor(value: string): { createdAt: string; id: string } { try { const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as { createdAt?: string; id?: string }; if (!parsed.id || !parsed.createdAt || Number.isNaN(Date.parse(parsed.createdAt))) throw new Error(); return { createdAt: parsed.createdAt, id: parsed.id }; } catch { throw new BadRequestException('Cursor is invalid'); } }
}
