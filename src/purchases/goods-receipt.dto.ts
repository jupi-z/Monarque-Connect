import { Transform, Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsISO8601, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';

const quantityPattern = /^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,6})?$/;
const signedQuantityPattern = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]{1,6})?$/;
const numberTransform = ({ value }: { value: unknown }): unknown => value === undefined ? value : Number(value);

export class GoodsReceiptOrganizationParams { @IsUUID() organizationId!: string; }
export class GoodsReceiptOrderParams { @IsUUID() organizationId!: string; @IsUUID() purchaseOrderId!: string; }
export class GoodsReceiptParams extends GoodsReceiptOrderParams { @IsUUID() receiptId!: string; }

export class CreateGoodsReceiptLineDto {
  @IsUUID() purchaseOrderLineId!: string;
  @IsString() @Matches(quantityPattern) quantity!: string;
}

export class CreateGoodsReceiptDto {
  @IsISO8601() receivedAt!: string;
  @IsOptional() @IsString() @MaxLength(160) reference?: string;
  @IsOptional() @IsString() @MaxLength(5000) notes?: string;
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => CreateGoodsReceiptLineDto) lines!: CreateGoodsReceiptLineDto[];
}

export class GoodsReceiptListQuery {
  @IsOptional() @IsString() cursor?: string;
  @IsOptional() @Transform(numberTransform) @IsInt() @Min(1) @Max(100) limit = 20;
}

export class GoodsReceiptCorrectionLineDto {
  @IsUUID() purchaseOrderLineId!: string;
  @IsString() @Matches(signedQuantityPattern) deltaQuantity!: string;
}

export class CorrectGoodsReceiptDto {
  @IsString() @MinLength(1) @MaxLength(2000) reason!: string;
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => GoodsReceiptCorrectionLineDto) lines!: GoodsReceiptCorrectionLineDto[];
}
