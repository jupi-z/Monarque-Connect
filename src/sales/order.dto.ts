import { Transform, Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsEnum, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { TaxMode } from './sales.types.js';

const numberTransform = ({ value }: { value: unknown }): unknown => value === undefined ? value : Number(value);
const decimalPattern = /^\d+(?:\.\d{1,6})?$/;
const moneyPattern = /^\d+(?:\.\d{1,4})?$/;

export class OrganizationOrderParams {
  @IsUUID()
  organizationId!: string;
}

export class OrderParams extends OrganizationOrderParams {
  @IsUUID()
  orderId!: string;
}

export class CreateSalesOrderLineDto {
  @IsOptional()
  @IsUUID()
  itemId?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  descriptionSnapshot!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(32)
  unitSnapshot!: string;

  @IsString()
  @Matches(decimalPattern)
  quantity!: string;

  @IsString()
  @Matches(moneyPattern)
  unitPrice!: string;

  @IsOptional()
  @IsString()
  @Matches(moneyPattern)
  discountAmount?: string;

  @IsEnum(TaxMode)
  taxMode!: TaxMode;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  taxCodeSnapshot?: string;

  @IsOptional()
  @IsString()
  @Matches(moneyPattern)
  taxRate?: string;
}

export class CreateSalesOrderDto {
  @IsUUID()
  establishmentId!: string;

  @IsUUID()
  partyId!: string;

  @IsString()
  @Matches(/^[A-Z]{3}$/)
  currency!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateSalesOrderLineDto)
  lines!: CreateSalesOrderLineDto[];
}

export class UpdateSalesOrderDto {
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateSalesOrderLineDto)
  lines?: CreateSalesOrderLineDto[];
}

export class OrderListQuery {
  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @Transform(numberTransform)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;
}
