import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type AuditAction } from '@prisma/client';
import { PrismaService } from '../database/prisma.service.js';
import { createDomainEvent } from '../events/domain-event.factory.js';
import { createRequestContext, currentEventContext } from '../events/event-context.js';
import { PrismaOutboxWriter } from '../events/prisma-outbox.writer.js';
import type { AuthPrincipal } from '../auth/auth.types.js';
import { AuthorizationService } from '../tenancy/authorization.service.js';
import type { InventoryTransferCommand } from './inventory.dto.js';
import { assertInventoryTransferReplayCompatible } from './inventory-idempotency.js';

@Injectable()
export class InventoryTransferService {
  constructor(private readonly prisma: PrismaService, private readonly authorization: AuthorizationService, private readonly outbox: PrismaOutboxWriter) {}

  async create(principal: AuthPrincipal, organizationId: string, input: InventoryTransferCommand, rawIdempotencyKey: string): Promise<unknown> {
    const context = await this.authorization.requireModule(principal, organizationId, 'INVENTORY', 'inventory:write');
    const idempotencyKey = rawIdempotencyKey?.trim();
    if (!idempotencyKey || idempotencyKey.length > 200) throw new BadRequestException('Idempotency-Key is required');
    if (input.fromWarehouseId === input.toWarehouseId) throw new BadRequestException('Source and destination warehouses must differ');
    const quantity = new Prisma.Decimal(input.quantity);
    if (!quantity.gt(0) || quantity.decimalPlaces() > 6) throw new BadRequestException('Quantity must be positive and have at most six decimal places');
    const eventContext = currentEventContext();
    const event = eventContext?.requestId ? { requestId: eventContext.requestId, correlationId: eventContext.correlationId } : createRequestContext();

    try {
      return await this.prisma.$transaction(async (tx) => {
        const outgoingKey = `${idempotencyKey}:out`;
        const incomingKey = `${idempotencyKey}:in`;
        const existingOutgoing = await tx.inventoryMovement.findUnique({ where: { organizationId_idempotencyKey: { organizationId, idempotencyKey: outgoingKey } }, select: this.select });
        if (existingOutgoing) {
          const existingIncoming = await tx.inventoryMovement.findUnique({ where: { organizationId_idempotencyKey: { organizationId, idempotencyKey: incomingKey } }, select: this.select });
          if (!existingIncoming) throw new ConflictException('Inventory transfer is incomplete');
          const replayWarehouses = await tx.warehouse.findMany({ where: { organizationId, id: { in: [input.fromWarehouseId, input.toWarehouseId] }, active: true }, select: { id: true, establishmentId: true } });
          if (replayWarehouses.length !== 2) throw new NotFoundException('Inventory warehouse not found');
          for (const warehouse of replayWarehouses) await this.authorization.assertEstablishment(context, warehouse.establishmentId);
          assertInventoryTransferReplayCompatible(existingOutgoing, existingIncoming, input);
          return this.serializeTransfer(existingOutgoing, existingIncoming, existingOutgoing.transferId ?? '');
        }

        const warehouses = await tx.warehouse.findMany({ where: { organizationId, id: { in: [input.fromWarehouseId, input.toWarehouseId] }, active: true }, select: { id: true, establishmentId: true } });
        if (warehouses.length !== 2) throw new NotFoundException('Inventory warehouse not found');
        const fromWarehouse = warehouses.find((warehouse) => warehouse.id === input.fromWarehouseId);
        const toWarehouse = warehouses.find((warehouse) => warehouse.id === input.toWarehouseId);
        if (!fromWarehouse || !toWarehouse) throw new NotFoundException('Inventory warehouse not found');
        await this.authorization.assertEstablishment(context, fromWarehouse.establishmentId);
        await this.authorization.assertEstablishment(context, toWarehouse.establishmentId);

        const lockKeys = [input.fromWarehouseId, input.toWarehouseId].sort().map((warehouseId) => `${organizationId}:${warehouseId}:${input.itemId}`);
        for (const lockKey of lockKeys) await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`);
        const item = await tx.item.findFirst({ where: { id: input.itemId, organizationId, active: true, trackInventory: true }, select: { id: true } });
        if (!item) throw new NotFoundException('Inventory item not found');
        const sourceBalance = await tx.inventoryBalance.findUnique({ where: { organizationId_warehouseId_itemId: { organizationId, warehouseId: input.fromWarehouseId, itemId: input.itemId } } });
        const sourceNext = (sourceBalance?.quantity ?? new Prisma.Decimal(0)).sub(quantity);
        if (sourceNext.lt(0)) throw new ConflictException('Insufficient inventory');
        const destinationBalance = await tx.inventoryBalance.findUnique({ where: { organizationId_warehouseId_itemId: { organizationId, warehouseId: input.toWarehouseId, itemId: input.itemId } } });
        const destinationNext = (destinationBalance?.quantity ?? new Prisma.Decimal(0)).add(quantity);
        const transferId = randomUUID();
        const outgoing = await tx.inventoryMovement.create({ data: { id: randomUUID(), organizationId, establishmentId: fromWarehouse.establishmentId, warehouseId: input.fromWarehouseId, itemId: input.itemId, movementType: 'TRANSFER_OUT', sourceType: 'TRANSFER', quantityDelta: quantity.negated().toFixed(6), transferId, idempotencyKey: outgoingKey, reason: input.reason?.trim() || null, occurredAt: input.occurredAt ? new Date(input.occurredAt) : new Date(), createdByUserId: principal.userId }, select: this.select });
        const incoming = await tx.inventoryMovement.create({ data: { id: randomUUID(), organizationId, establishmentId: toWarehouse.establishmentId, warehouseId: input.toWarehouseId, itemId: input.itemId, movementType: 'TRANSFER_IN', sourceType: 'TRANSFER', quantityDelta: quantity.toFixed(6), transferId, idempotencyKey: incomingKey, reason: input.reason?.trim() || null, occurredAt: input.occurredAt ? new Date(input.occurredAt) : new Date(), createdByUserId: principal.userId }, select: this.select });
        await tx.inventoryBalance.upsert({ where: { organizationId_warehouseId_itemId: { organizationId, warehouseId: input.fromWarehouseId, itemId: input.itemId } }, create: { organizationId, warehouseId: input.fromWarehouseId, itemId: input.itemId, quantity: sourceNext.toFixed(6) }, update: { quantity: sourceNext.toFixed(6) } });
        await tx.inventoryBalance.upsert({ where: { organizationId_warehouseId_itemId: { organizationId, warehouseId: input.toWarehouseId, itemId: input.itemId } }, create: { organizationId, warehouseId: input.toWarehouseId, itemId: input.itemId, quantity: destinationNext.toFixed(6) }, update: { quantity: destinationNext.toFixed(6) } });
        await this.recordMutation(tx, 'INVENTORY_TRANSFER_CREATED', principal, organizationId, fromWarehouse.establishmentId, transferId, event, { transferId, itemId: input.itemId, fromWarehouseId: input.fromWarehouseId, toWarehouseId: input.toWarehouseId, quantity: quantity.toFixed(6) });
        return this.serializeTransfer(outgoing, incoming, transferId);
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const existingOutgoing = await this.prisma.inventoryMovement.findUnique({ where: { organizationId_idempotencyKey: { organizationId, idempotencyKey: `${idempotencyKey}:out` } }, select: this.select });
        const existingIncoming = await this.prisma.inventoryMovement.findUnique({ where: { organizationId_idempotencyKey: { organizationId, idempotencyKey: `${idempotencyKey}:in` } }, select: this.select });
        if (existingOutgoing && existingIncoming) {
          assertInventoryTransferReplayCompatible(existingOutgoing, existingIncoming, input);
          return this.serializeTransfer(existingOutgoing, existingIncoming, existingOutgoing.transferId ?? '');
        }
      }
      throw error;
    }
  }

  private async recordMutation(tx: Prisma.TransactionClient, action: AuditAction, principal: AuthPrincipal, organizationId: string, establishmentId: string, transferId: string, context: { requestId: string; correlationId: string }, payload: Record<string, unknown>): Promise<void> {
    await tx.auditEvent.create({ data: { id: randomUUID(), action, actorUserId: principal.userId, organizationId, establishmentId, targetType: 'InventoryTransfer', targetId: transferId, requestId: context.requestId, correlationId: context.correlationId, metadataJson: payload as Prisma.InputJsonValue } });
    await this.outbox.enqueue(tx, createDomainEvent({ eventType: 'inventory.transfer.created', eventVersion: 1, occurredAt: new Date().toISOString(), actor: { type: 'USER', id: principal.userId }, aggregate: { type: 'InventoryTransfer', id: transferId }, organizationId, establishmentId, correlationId: context.correlationId, requestId: context.requestId, dataClassification: 'CONFIDENTIAL', purpose: 'inventory-ledger', payload }));
  }

  private readonly select = { id: true, organizationId: true, establishmentId: true, warehouseId: true, itemId: true, movementType: true, sourceType: true, quantityDelta: true, sourceId: true, sourceLineId: true, transferId: true, idempotencyKey: true, reason: true, occurredAt: true, createdByUserId: true, createdAt: true } as const;

  private serializeTransfer(outgoing: { id: string; quantityDelta: Prisma.Decimal; warehouseId: string }, incoming: { id: string; quantityDelta: Prisma.Decimal; warehouseId: string }, transferId: string): unknown {
    return { transferId, outgoing: { id: outgoing.id, warehouseId: outgoing.warehouseId, quantityDelta: outgoing.quantityDelta.toFixed(6) }, incoming: { id: incoming.id, warehouseId: incoming.warehouseId, quantityDelta: incoming.quantityDelta.toFixed(6) } };
  }
}
