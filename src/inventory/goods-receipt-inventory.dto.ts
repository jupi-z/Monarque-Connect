import { IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { Transform } from 'class-transformer';

const numberTransform = ({ value }: { value: unknown }): unknown => value === undefined ? value : Number(value);

export class PendingGoodsReceiptInventoryQuery {
  @IsOptional()
  @IsUUID()
  establishmentId?: string;

  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @Transform(numberTransform)
  @Min(1)
  @Max(100)
  limit = 20;
}

export class GoodsReceiptInventoryAssignmentDto {
  @IsUUID()
  establishmentId!: string;

  @IsUUID()
  warehouseId!: string;

  @IsString()
  @MaxLength(2000)
  reason!: string;
}

export class GoodsReceiptInventoryImportDto extends GoodsReceiptInventoryAssignmentDto {}
