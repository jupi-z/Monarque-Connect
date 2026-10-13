import { Transform, Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsEnum, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength, ValidateNested, IsInt } from 'class-validator';
import { TaxMode } from '../sales/sales.types.js';

const decimalPattern = /^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,6})?$/;
const moneyPattern = /^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,4})?$/;
const numberTransform = ({ value }: { value: unknown }): unknown => value === undefined ? value : Number(value);

export class PurchaseOrderParams { @IsUUID() organizationId!: string; @IsUUID() purchaseOrderId!: string; }
export class PurchaseOrderOrganizationParams { @IsUUID() organizationId!: string; }

export class CreatePurchaseOrderLineDto {
  @IsOptional() @IsUUID() sourceRfqLineId?: string;
  @IsOptional() @IsUUID() itemId?: string;
  @IsString() @MinLength(1) @MaxLength(2000) descriptionSnapshot!: string;
  @IsString() @MinLength(1) @MaxLength(32) unitSnapshot!: string;
  @IsString() @Matches(decimalPattern) quantity!: string;
  @IsString() @Matches(moneyPattern) unitPrice!: string;
  @IsOptional() @IsString() @Matches(moneyPattern) discountAmount?: string;
  @IsEnum(TaxMode) taxMode!: TaxMode;
  @IsOptional() @IsString() @Matches(moneyPattern) taxRate?: string;
  @IsOptional() @IsString() @MaxLength(80) taxCodeSnapshot?: string;
}

export class CreatePurchaseOrderDto {
  @IsUUID() establishmentId!: string;
  @IsOptional() @IsUUID() sourceSupplierRfqId?: string;
  @IsOptional() @IsUUID() sourceRecipientId?: string;
  @IsOptional() @IsUUID() supplierPartyId?: string;
  @IsOptional() @IsUUID() supplierNetworkOrganizationId?: string;
  @IsString() @Matches(/^[A-Z]{3}$/) currency!: string;
  @IsOptional() @IsString() @MaxLength(5000) notes?: string;
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => CreatePurchaseOrderLineDto) lines!: CreatePurchaseOrderLineDto[];
}

export class UpdatePurchaseOrderDto {
  @IsOptional() @IsString() @MaxLength(5000) notes?: string | null;
  @IsOptional() @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => CreatePurchaseOrderLineDto) lines?: CreatePurchaseOrderLineDto[];
}

export class PurchaseOrderListQuery {
  @IsOptional() @IsUUID() establishmentId?: string;
  @IsOptional() @IsString() cursor?: string;
  @IsOptional() @Transform(numberTransform) @IsInt() @Min(1) @Max(100) limit = 20;
}
