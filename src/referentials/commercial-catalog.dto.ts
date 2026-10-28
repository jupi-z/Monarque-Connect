import { Transform } from 'class-transformer';
import { IsDateString, IsIn, IsInt, IsObject, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { PRODUCT_CODES, type ProductCode } from '../products/product-code.js';

export class CommercialCatalogOrganizationParams {
  @IsUUID()
  organizationId!: string;
}

export class CommercialOfferParams extends CommercialCatalogOrganizationParams {
  @IsUUID()
  offerId!: string;
}

export class CommercialPriceVersionParams extends CommercialOfferParams {}

export class CreateCommercialPriceVersionDto {
  @IsString()
  @MaxLength(25)
  @Matches(/^(?=.*[1-9])(?:0|[1-9]\d{0,15})(?:\.\d{1,8})?$/)
  amount!: string;

  @IsString()
  @Matches(/^[A-Z]{3}$/)
  currencyCode!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(32)
  priceUnitCode!: string;

  @IsOptional()
  @IsDateString({ strict: true })
  effectiveFrom?: string;

  @IsOptional()
  @IsUUID()
  expectedLatestVersionId?: string;
}

export class CatalogItemVariantParams extends CommercialCatalogOrganizationParams {
  @IsUUID()
  itemId!: string;
}

export class CommercialOfferListQuery {
  @IsIn(PRODUCT_CODES)
  productCode!: ProductCode;

  @IsOptional()
  @IsUUID()
  establishmentId?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(48)
  channelCode?: string;

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

export class CreateCommercialOfferDto {
  @IsIn(PRODUCT_CODES)
  productCode!: ProductCode;

  @IsUUID()
  itemId!: string;

  @IsOptional()
  @IsUUID()
  variantId?: string;

  @IsOptional()
  @IsUUID()
  establishmentId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(48)
  channelCode?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(32)
  sellUnitCode!: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  displayName?: string;
}

export class CreateItemVariantDto {
  @IsIn(PRODUCT_CODES)
  productCode!: ProductCode;

  @IsString()
  @MinLength(1)
  @MaxLength(64)
  code!: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  displayName?: string;

  @IsOptional()
  @IsObject()
  attributes?: Record<string, string>;
}

export class UpdateCommercialOfferDto {
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @IsOptional()
  @IsUUID()
  establishmentId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(48)
  channelCode?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  displayName?: string | null;

  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE'])
  status?: 'ACTIVE' | 'INACTIVE';
}

export type CatalogIdempotencyKey = string | undefined;
