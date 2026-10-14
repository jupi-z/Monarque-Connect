import { Prisma } from '@prisma/client';
import { ConflictException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import {
  assertInventoryMovementReplayCompatible,
  assertInventoryTransferReplayCompatible,
  canonicalInventoryMovementCommand,
  canonicalInventoryTransferCommand,
  type InventoryMovementReplayRecord,
  type InventoryTransferReplayRecord,
} from '../../src/inventory/inventory-idempotency.js';

const ids = {
  establishmentId: '00000000-0000-0000-0000-000000000001',
  fromWarehouseId: '00000000-0000-0000-0000-000000000002',
  toWarehouseId: '00000000-0000-0000-0000-000000000003',
  warehouseId: '00000000-0000-0000-0000-000000000002',
  itemId: '00000000-0000-0000-0000-000000000004',
};

describe('Inventory idempotency payloads', () => {
  it('canonicalizes equivalent movement commands and rejects divergent payloads', () => {
    const command = { ...ids, movementType: 'ADJUSTMENT_IN' as const, sourceType: 'MANUAL' as const, quantity: '1', reason: '  opening  ' };
    const stored: InventoryMovementReplayRecord = {
      ...ids,
      movementType: 'ADJUSTMENT_IN',
      sourceType: 'MANUAL',
      quantityDelta: new Prisma.Decimal('1.000000'),
      sourceId: null,
      sourceLineId: null,
      sourceRevision: null,
      transferId: null,
      reason: 'opening',
      occurredAt: new Date('2026-10-14T10:00:00.000Z'),
    };

    expect(canonicalInventoryMovementCommand(command)).toBe(canonicalInventoryMovementCommand({ ...command, quantity: '1.000000', reason: 'opening' }));
    expect(() => assertInventoryMovementReplayCompatible(stored, command)).not.toThrow();
    expect(() => assertInventoryMovementReplayCompatible(stored, { ...command, quantity: '2' })).toThrow(ConflictException);
    expect(() => assertInventoryMovementReplayCompatible(stored, { ...command, warehouseId: ids.toWarehouseId })).toThrow(ConflictException);
  });

  it('rejects a transfer replay that changes either warehouse, item or quantity', () => {
    const command = { ...ids, quantity: '2', reason: 'relocation' };
    const outgoing: InventoryTransferReplayRecord = {
      warehouseId: ids.fromWarehouseId,
      itemId: ids.itemId,
      quantityDelta: new Prisma.Decimal('-2.000000'),
      reason: 'relocation',
      occurredAt: new Date('2026-10-14T10:00:00.000Z'),
    };
    const incoming: InventoryTransferReplayRecord = {
      warehouseId: ids.toWarehouseId,
      itemId: ids.itemId,
      quantityDelta: new Prisma.Decimal('2.000000'),
      reason: 'relocation',
      occurredAt: new Date('2026-10-14T10:00:00.000Z'),
    };

    expect(canonicalInventoryTransferCommand(command)).toBe(canonicalInventoryTransferCommand({ ...command, quantity: '2.000000' }));
    expect(() => assertInventoryTransferReplayCompatible(outgoing, incoming, command)).not.toThrow();
    expect(() => assertInventoryTransferReplayCompatible(outgoing, incoming, { ...command, quantity: '3' })).toThrow(ConflictException);
    expect(() => assertInventoryTransferReplayCompatible(outgoing, incoming, { ...command, toWarehouseId: ids.warehouseId })).toThrow(ConflictException);
  });
});
