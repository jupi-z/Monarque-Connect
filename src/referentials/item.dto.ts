import { IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';

const booleanTransform = ({ value }: { value: unknown }): unknown => value === undefined ? value : value === true || value === 'true';
const numberTransform = ({ value }: { value: unknown }): unknown => value === undefined ? value : Number(value);

export class OrganizationItemParams {
  @IsUUID()
  organizationId!: string;
}

export class ItemParams extends OrganizationItemParams {
  @IsUUID()
  itemId!: string;
}

export class CreateItemDto {
  @IsIn(['PRODUCT', 'SERVICE'])
  type!: 'PRODUCT' | 'SERVICE';

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  sku?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(160)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(32)
  unit!: string;

  @IsString()
  @Matches(/^\d+(?:\.\d{1,4})?$/)
  referencePrice!: string;

  @IsString()
  @Matches(/^[A-Za-z]{3}$/)
  currency!: string;

  @IsOptional()
  @IsBoolean()
  trackInventory?: boolean;
}

export class UpdateItemDto {
  @IsOptional()
  @IsIn(['PRODUCT', 'SERVICE'])
  type?: 'PRODUCT' | 'SERVICE';

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  sku?: string | null;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string | null;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(32)
  unit?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d+(?:\.\d{1,4})?$/)
  referencePrice?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z]{3}$/)
  currency?: string;

  @IsOptional()
  @IsBoolean()
  trackInventory?: boolean;
}

export class ItemListQuery {
  @IsOptional()
  @IsIn(['PRODUCT', 'SERVICE'])
  type?: 'PRODUCT' | 'SERVICE';

  @IsOptional()
  @Transform(booleanTransform)
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  search?: string;

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
