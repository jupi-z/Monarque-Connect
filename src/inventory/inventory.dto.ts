import { Transform } from 'class-transformer';
import { IsDateString, IsEnum, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import type { InventoryMovementSourceType, InventoryMovementType } from '@prisma/client';

export class CreateInventoryMovementDto {
  @IsUUID()
  establishmentId!: string;

  @IsUUID()
  warehouseId!: string;

  @IsUUID()
  itemId!: string;

  @IsEnum(['ADJUSTMENT_IN', 'ADJUSTMENT_OUT'])
  movementType!: 'ADJUSTMENT_IN' | 'ADJUSTMENT_OUT';

  @Matches(/^\d+(?:\.\d{1,6})?$/)
  quantityDelta!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  reason!: string;

  @IsDateString()
  occurredAt!: string;
}

export type InventoryMovementCommand = {
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

export class InventoryListQuery {
  @IsOptional()
  @IsUUID()
  establishmentId?: string;

  @IsOptional()
  @IsUUID()
  warehouseId?: string;

  @IsOptional()
  @IsUUID()
  itemId?: string;

  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) => value === undefined ? value : Number(value))
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;
}

export class CreateInventoryTransferHttpDto {
  @IsUUID()
  establishmentId!: string;

  @IsUUID()
  sourceWarehouseId!: string;

  @IsUUID()
  destinationWarehouseId!: string;

  @IsUUID()
  itemId!: string;

  @Matches(/^\d+(?:\.\d{1,6})?$/)
  quantity!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  reason!: string;

  @IsDateString()
  occurredAt!: string;
}

export type InventoryTransferCommand = {
  fromWarehouseId: string;
  toWarehouseId: string;
  itemId: string;
  quantity: string;
  reason?: string;
  occurredAt?: string;
};

export class ReconcileInventoryDto {
  @IsUUID()
  establishmentId!: string;

  @IsUUID()
  warehouseId!: string;

  @IsUUID()
  itemId!: string;

  @Matches(/^\d+(?:\.\d{1,6})?$/)
  observedQuantity!: string;
}
