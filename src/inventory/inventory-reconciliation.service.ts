import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type InventoryReconciliation as InventoryReconciliationRow } from '@prisma/client';
import { PrismaService } from '../database/prisma.service.js';
import { createDomainEvent } from '../events/domain-event.factory.js';
import { createRequestContext, currentEventContext } from '../events/event-context.js';
import { PrismaOutboxWriter } from '../events/prisma-outbox.writer.js';
import type { AuthPrincipal } from '../auth/auth.types.js';
import { AuthorizationService } from '../tenancy/authorization.service.js';
import type { ReconcileInventoryDto } from './inventory.dto.js';

@Injectable()
export class InventoryReconciliationService {
  constructor(private readonly prisma: PrismaService, private readonly authorization: AuthorizationService, private readonly outbox: PrismaOutboxWriter) {}

  async reconcile(principal: AuthPrincipal, organizationId: string, input: ReconcileInventoryDto, rawIdempotencyKey: string | undefined): Promise<unknown> {
    const context = await this.authorization.requireModule(principal, organizationId, 'INVENTORY', 'inventory:write');
    await this.authorization.assertEstablishment(context, input.establishmentId);
    const idempotencyKey = this.requireKey(rawIdempotencyKey);
    const observedQuantity = this.parseQuantity(input.observedQuantity);
    const eventContext = currentEventContext();
    const event = eventContext?.requestId ? { requestId: eventContext.requestId, correlationId: eventContext.correlationId } : createRequestContext();

    try {
      return await this.prisma.$transaction(async (tx) => {
        const replay = await tx.inventoryReconciliation.findUnique({ where: { organizationId_idempotencyKey: { organizationId, idempotencyKey } } });
        if (replay) {
          this.assertReplay(replay, input, observedQuantity);
          return this.serialize(replay);
        }

        await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${organizationId}:${input.warehouseId}:${input.itemId}`}, 0))`);
        const warehouse = await tx.warehouse.findFirst({ where: { id: input.warehouseId, organizationId, establishmentId: input.establishmentId, active: true }, select: { id: true } });
        const item = await tx.item.findFirst({ where: { id: input.itemId, organizationId, active: true, trackInventory: true }, select: { id: true } });
        if (!warehouse || !item) throw new NotFoundException('Inventory warehouse or item not found');
        const aggregate = await tx.inventoryMovement.aggregate({ where: { organizationId, establishmentId: input.establishmentId, warehouseId: input.warehouseId, itemId: input.itemId }, _sum: { quantityDelta: true } });
        const ledgerQuantity = aggregate._sum.quantityDelta ?? new Prisma.Decimal(0);
        if (ledgerQuantity.lt(0)) throw new ConflictException('Inventory ledger is inconsistent');
        const delta = observedQuantity.sub(ledgerQuantity);
        const reconciliation = await tx.inventoryReconciliation.create({ data: { id: randomUUID(), organizationId, establishmentId: input.establishmentId, warehouseId: input.warehouseId, itemId: input.itemId, ledgerQuantity: ledgerQuantity.toFixed(6), observedQuantity: observedQuantity.toFixed(6), delta: delta.toFixed(6), matched: delta.isZero(), idempotencyKey, createdByUserId: principal.userId }, });
        const payload = { reconciliationId: reconciliation.id, warehouseId: input.warehouseId, itemId: input.itemId, ledgerQuantity: ledgerQuantity.toFixed(6), observedQuantity: observedQuantity.toFixed(6), delta: delta.toFixed(6), matched: delta.isZero() };
        await tx.auditEvent.create({ data: { id: randomUUID(), action: 'INVENTORY_BALANCE_RECONCILED', actorUserId: principal.userId, organizationId, establishmentId: input.establishmentId, targetType: 'InventoryReconciliation', targetId: reconciliation.id, requestId: event.requestId, correlationId: event.correlationId, metadataJson: payload } });
        await this.outbox.enqueue(tx, createDomainEvent({ eventType: 'inventory.balance.reconciled.v1', eventVersion: 1, occurredAt: new Date().toISOString(), actor: { type: 'USER', id: principal.userId }, aggregate: { type: 'InventoryReconciliation', id: reconciliation.id }, organizationId, establishmentId: input.establishmentId, correlationId: event.correlationId, requestId: event.requestId, dataClassification: 'CONFIDENTIAL', purpose: 'inventory-ledger', payload }));
        return this.serialize(reconciliation);
      });
    } catch (error) {
      if (this.isUnique(error)) {
        const existing = await this.prisma.inventoryReconciliation.findUnique({ where: { organizationId_idempotencyKey: { organizationId, idempotencyKey } } });
        if (existing) {
          this.assertReplay(existing, input, observedQuantity);
          return this.serialize(existing);
        }
      }
      throw error;
    }
  }

  private assertReplay(existing: InventoryReconciliationRow, input: ReconcileInventoryDto, observedQuantity: Prisma.Decimal): void {
    if (existing.establishmentId !== input.establishmentId || existing.warehouseId !== input.warehouseId || existing.itemId !== input.itemId || !existing.observedQuantity.equals(observedQuantity)) {
      throw new ConflictException('Idempotency key was already used with a different inventory reconciliation payload');
    }
  }

  private serialize(row: InventoryReconciliationRow): unknown {
    return { id: row.id, organizationId: row.organizationId, establishmentId: row.establishmentId, warehouseId: row.warehouseId, itemId: row.itemId, ledgerQuantity: row.ledgerQuantity.toFixed(6), observedQuantity: row.observedQuantity.toFixed(6), delta: row.delta.toFixed(6), matched: row.matched, createdAt: row.createdAt.toISOString() };
  }

  private parseQuantity(value: string): Prisma.Decimal {
    const quantity = new Prisma.Decimal(value);
    if (quantity.lt(0) || quantity.decimalPlaces() > 6 || quantity.gte(new Prisma.Decimal('1000000000000'))) throw new BadRequestException('Observed quantity must be non-negative and have at most six decimal places');
    return quantity;
  }

  private requireKey(value: string | undefined): string { if (!value?.trim() || value.length > 200 || /[\r\n]/.test(value)) throw new BadRequestException('Idempotency-Key is required and invalid'); return value.trim(); }
  private isUnique(error: unknown): boolean { return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'; }
}
