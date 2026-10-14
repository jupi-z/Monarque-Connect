import { IsDateString, IsEnum, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import type { InventoryMovementSourceType, InventoryMovementType } from '@prisma/client';

export class CreateInventoryMovementDto {
  @IsUUID()
  establishmentId!: string;

  @IsUUID()
  warehouseId!: string;

  @IsUUID()
  itemId!: string;

  @IsEnum(['RECEIPT_IN', 'SALE_OUT', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT', 'TRANSFER_IN', 'TRANSFER_OUT'])
  movementType!: InventoryMovementType;

  @IsEnum(['MANUAL', 'GOODS_RECEIPT', 'SALE', 'TRANSFER', 'HISTORICAL_IMPORT', 'RECONCILIATION'])
  sourceType!: InventoryMovementSourceType;

  @Matches(/^\d+(?:\.\d{1,6})?$/)
  quantity!: string;

  @IsOptional()
  @IsUUID()
  sourceId?: string;

  @IsOptional()
  @IsUUID()
  sourceLineId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  sourceRevision?: string;

  @IsOptional()
  @IsUUID()
  transferId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;

  @IsOptional()
  @IsDateString()
  occurredAt?: string;
}

export class CreateInventoryTransferDto {
  @IsUUID()
  fromWarehouseId!: string;

  @IsUUID()
  toWarehouseId!: string;

  @IsUUID()
  itemId!: string;

  @Matches(/^\d+(?:\.\d{1,6})?$/)
  quantity!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;

  @IsOptional()
  @IsDateString()
  occurredAt?: string;
}
