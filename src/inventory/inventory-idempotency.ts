import { ConflictException } from '@nestjs/common';
import { Prisma, type InventoryMovementSourceType, type InventoryMovementType } from '@prisma/client';

export type InventoryMovementReplayCommand = {
  establishmentId: string;
  warehouseId: string;
  itemId: string;
  movementType: InventoryMovementType;
  sourceType: InventoryMovementSourceType;
  quantity: string;
  sourceId?: string;
  sourceLineId?: string;
  sourceRevision?: string;
  transferId?: string;
  reason?: string;
  occurredAt?: string;
};

export type InventoryMovementReplayRecord = {
  establishmentId: string;
  warehouseId: string;
  itemId: string;
  movementType: InventoryMovementType;
  sourceType: string;
  quantityDelta: Prisma.Decimal | string;
  sourceId: string | null;
  sourceLineId: string | null;
  sourceRevision: string | null;
  transferId: string | null;
  reason: string | null;
  occurredAt: Date;
};

export type InventoryTransferReplayCommand = {
  fromWarehouseId: string;
  toWarehouseId: string;
  itemId: string;
  quantity: string;
  reason?: string;
  occurredAt?: string;
};

export type InventoryTransferReplayRecord = {
  warehouseId: string;
  itemId: string;
  quantityDelta: Prisma.Decimal | string;
  reason: string | null;
  occurredAt: Date;
};

const OUT_MOVEMENTS = new Set<InventoryMovementType>(['SALE_OUT', 'ADJUSTMENT_OUT', 'TRANSFER_OUT']);

export function canonicalInventoryMovementCommand(input: InventoryMovementReplayCommand): string {
  return JSON.stringify({
    establishmentId: input.establishmentId,
    warehouseId: input.warehouseId,
    itemId: input.itemId,
    movementType: input.movementType,
    sourceType: input.sourceType,
    quantity: decimal(input.quantity),
    sourceId: input.sourceId ?? null,
    sourceLineId: input.sourceLineId ?? null,
    sourceRevision: input.sourceRevision?.trim() || (input.sourceId && input.sourceLineId ? 'LEGACY' : null),
    transferId: input.transferId ?? null,
    reason: normalizeText(input.reason),
    ...(input.occurredAt === undefined ? {} : { occurredAt: new Date(input.occurredAt).toISOString() }),
  });
}

export function canonicalInventoryTransferCommand(input: InventoryTransferReplayCommand): string {
  return JSON.stringify({
    fromWarehouseId: input.fromWarehouseId,
    toWarehouseId: input.toWarehouseId,
    itemId: input.itemId,
    quantity: decimal(input.quantity),
    reason: normalizeText(input.reason),
    ...(input.occurredAt === undefined ? {} : { occurredAt: new Date(input.occurredAt).toISOString() }),
  });
}

export function assertInventoryMovementReplayCompatible(existing: InventoryMovementReplayRecord, input: InventoryMovementReplayCommand): void {
  const existingCommand: InventoryMovementReplayCommand = {
    establishmentId: existing.establishmentId,
    warehouseId: existing.warehouseId,
    itemId: existing.itemId,
    movementType: existing.movementType,
    sourceType: existing.sourceType as InventoryMovementSourceType,
    quantity: new Prisma.Decimal(existing.quantityDelta).abs().toFixed(6),
    ...(existing.sourceId ? { sourceId: existing.sourceId } : {}),
    ...(existing.sourceLineId ? { sourceLineId: existing.sourceLineId } : {}),
    ...(existing.sourceRevision ? { sourceRevision: existing.sourceRevision } : {}),
    ...(existing.transferId ? { transferId: existing.transferId } : {}),
    ...(existing.reason ? { reason: existing.reason } : {}),
    ...(input.occurredAt === undefined ? {} : { occurredAt: existing.occurredAt.toISOString() }),
  };
  if (canonicalInventoryMovementCommand(existingCommand) !== canonicalInventoryMovementCommand(input)) {
    throw new ConflictException('Idempotency key was already used with a different inventory movement payload');
  }
  const expectedDelta = (OUT_MOVEMENTS.has(input.movementType) ? new Prisma.Decimal(input.quantity).negated() : new Prisma.Decimal(input.quantity)).toFixed(6);
  if (new Prisma.Decimal(existing.quantityDelta).toFixed(6) !== expectedDelta) {
    throw new ConflictException('Idempotency key was already used with a different inventory movement payload');
  }
}

export function assertInventoryTransferReplayCompatible(existingOutgoing: InventoryTransferReplayRecord, existingIncoming: InventoryTransferReplayRecord, input: InventoryTransferReplayCommand): void {
  const outgoingCommand: InventoryTransferReplayCommand = {
    fromWarehouseId: existingOutgoing.warehouseId,
    toWarehouseId: existingIncoming.warehouseId,
    itemId: existingOutgoing.itemId,
    quantity: new Prisma.Decimal(existingOutgoing.quantityDelta).abs().toFixed(6),
    ...(existingOutgoing.reason ? { reason: existingOutgoing.reason } : {}),
    ...(input.occurredAt === undefined ? {} : { occurredAt: existingOutgoing.occurredAt.toISOString() }),
  };
  const incomingMatches = existingIncoming.itemId === existingOutgoing.itemId
    && new Prisma.Decimal(existingIncoming.quantityDelta).toFixed(6) === new Prisma.Decimal(input.quantity).toFixed(6)
    && normalizeText(existingIncoming.reason) === normalizeText(existingOutgoing.reason);
  if (!incomingMatches || canonicalInventoryTransferCommand(outgoingCommand) !== canonicalInventoryTransferCommand(input)) {
    throw new ConflictException('Idempotency key was already used with a different inventory transfer payload');
  }
}

function decimal(value: Prisma.Decimal | string): string {
  return new Prisma.Decimal(value).toFixed(6);
}

function normalizeText(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized || null;
}
